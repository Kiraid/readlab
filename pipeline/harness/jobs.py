"""Uploads and jobs, on disk (no database yet). Used by the API in app/backend.

  sources/uploads/<id>/   file.pdf, meta.json (name, pages, chapter options from the outline)
  sources/jobs/<id>/      job.json (what was asked), status.json, events.jsonl, ledger.jsonl, and the chapter
                          graph's outputs (see pipeline/harness/chapter.py)

A job runs the chapter graph in a background thread of the server process. Good enough for one person on one
machine; the queue + worker comes when there are users.
"""
from __future__ import annotations

import json
import re
import threading
import time
import traceback
import uuid
from collections import defaultdict
from pathlib import Path

from pipeline.harness.chapter import build_graph, emit, set_status
from pipeline.harness.page import run_chapter_id
from pipeline.ingest.config import ROOT
from pipeline.ingest.outline import read_outline
from pipeline.llm import load_config
from pipeline.llm.core import read_ledger

UPLOADS = ROOT / "sources" / "uploads"
JOBS = ROOT / "sources" / "jobs"
SKIP = re.compile(r"^(cover|copyright|table of contents|contents|brief contents|preface|foreword|acknowledg|about (the|this)|"
                  r"index|colophon|dedication|praise|bibliography|glossary|appendix [a-z]\.? bibliography|how to contact|o.reilly)", re.I)
_threads: dict[str, threading.Thread] = {}


def _id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]


def chapter_options(pdf: Path, cache: Path) -> list[dict]:
    """What a person can pick: outline entries that have sections under them (chapters), else the top level,
    else the whole document."""
    from pypdf import PdfReader

    n = len(PdfReader(str(pdf)).pages)
    entries = read_outline(pdf, cache)
    if not entries:
        return [{"selector": "__all__", "title": "Whole document", "pages": [1, n], "sections": 0}]
    from statistics import median

    cands = []
    for i, e in enumerate(entries):
        if SKIP.search(e.title):
            continue
        kids, end = 0, n - 1
        for f in entries[i + 1:]:
            if f.level <= e.level:
                end = f.page - 1
                break
            kids += f.level == e.level + 1
        if kids:
            cands.append({"selector": f"#{i}", "title": e.title, "pages": [e.page + 1, max(e.page, end) + 1],
                          "sections": kids, "level": e.level})
    # chapters are the shallowest level whose entries have sections and a chapter-like length: parts
    # ("Part I", "Virtualization") are too long, sections too short
    chosen = None
    for level in sorted({c["level"] for c in cands}):
        spans = [c["pages"][1] - c["pages"][0] + 1 for c in cands if c["level"] == level]
        if len(spans) >= 2 and median(spans) <= 80:
            chosen = level
            break
    if chosen is None and cands:
        chosen = max({c["level"] for c in cands}, key=lambda L: sum(c["level"] == L for c in cands))
    opts = [c for c in cands if c["level"] == chosen]
    if not opts:  # an outline with no nesting (an article's headings): offer its top-level entries
        opts = [{"selector": f"#{i}", "title": e.title, "pages": [e.page + 1, e.page + 1], "sections": 0}
                for i, e in enumerate(entries) if e.level == 0 and not SKIP.search(e.title)]
    return [{k: o[k] for k in ("selector", "title", "pages", "sections")} for o in opts] + \
        [{"selector": "__all__", "title": "Whole document (no chapter split)", "pages": [1, n], "sections": 0}]


def save_upload(filename: str, data: bytes) -> dict:
    if not data.startswith(b"%PDF"):
        raise ValueError("only PDF files are supported for now")
    uid = _id()
    d = UPLOADS / uid
    d.mkdir(parents=True)
    pdf = d / "file.pdf"
    pdf.write_bytes(data)
    from pypdf import PdfReader
    meta = {"id": uid, "name": filename, "bytes": len(data), "pages": len(PdfReader(str(pdf)).pages),
            "chapters": chapter_options(pdf, d), "uploaded": time.time()}
    (d / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    return meta


def get_upload(uid: str) -> dict:
    p = UPLOADS / uid / "meta.json"
    if not p.exists():
        raise KeyError(uid)
    return json.loads(p.read_text(encoding="utf-8"))


def list_uploads() -> list[dict]:
    if not UPLOADS.exists():
        return []
    out = [json.loads((d / "meta.json").read_text(encoding="utf-8")) for d in UPLOADS.iterdir() if (d / "meta.json").exists()]
    return sorted(({k: u[k] for k in ("id", "name", "pages", "uploaded")} for u in out), key=lambda u: -u["uploaded"])


def printed_number(pdf: Path, opt: dict) -> str | None:
    """A chapter whose bookmark has no number often prints one on its first page, on a line of its own just above
    the title ("7" / "Scheduling: Introduction"). Use it so section ids match the book's own figure numbers."""
    import pdfplumber

    try:
        with pdfplumber.open(str(pdf)) as doc:
            lines = [l.strip() for l in (doc.pages[opt["pages"][0] - 1].extract_text() or "").splitlines()[:6]]
    except Exception:  # noqa: BLE001
        return None
    want = re.sub(r"[^a-z]", "", opt["title"].lower())
    for a, b in zip(lines, lines[1:]):
        line = re.sub(r"[^a-z]", "", b.lower())  # the title line, or its first part when the title wraps
        if re.fullmatch(r"\d{1,3}", a) and len(line) >= 5 and (line.startswith(want[:12]) or want.startswith(line)):
            return a
    return None


PROBE_KINDS = {"single", "multi", "text"}


def probe_questions(upload_id: str, selector: str) -> dict:
    """3-4 questions about this chapter whose answers tell the planner where the reader stands (prerequisites, a
    likely wrong idea, their goal). Built from the chapter's section titles and a few of its pages, with one cheap
    call; the same chapter always gets the same questions (the response cache)."""
    import pdfplumber

    from pipeline.llm.core import Call, call

    up = get_upload(upload_id)
    opt = next((c for c in up["chapters"] if c["selector"] == selector), None)
    if not opt:
        raise KeyError(f"no chapter {selector!r} in upload {upload_id}")
    pdf = UPLOADS / upload_id / "file.pdf"
    first, last = opt["pages"]
    pages = sorted({first, first + 1, (first + last) // 2, first + 3 * (last - first) // 4} & set(range(first, last + 1)))
    with pdfplumber.open(str(pdf)) as doc:
        text = "\n\n".join((doc.pages[p - 1].extract_text() or "") for p in pages if p - 1 < len(doc.pages))
    titles = [e.title for e in read_outline(pdf, UPLOADS / upload_id) if first - 1 <= e.page <= last - 1]
    cfg = load_config()
    node = cfg["nodes"].get("probe") or cfg["nodes"]["digest"]
    user = "\n".join([f"# {opt['title']}", "", "## Sections", "", *[f"- {t}" for t in titles[:30]], "",
                      "## A few pages of the chapter", "", "<text>", text[:9000], "</text>", "", "Return the questions JSON."])
    from pipeline.harness.chapter import parse_json
    res = call(Call(node="probe", provider=node["provider"], model=node["model"], thinking=node.get("thinking", False),
                    max_tokens=node.get("max_tokens", 3000), json_mode=True, tag=selector,
                    system=(ROOT / "pipeline" / "prompts" / "probe_system.md").read_text(encoding="utf-8"), user=user),
               ledger=UPLOADS / upload_id / "probe-ledger.jsonl")
    qs = []
    for i, q in enumerate((parse_json(res.text).get("questions") or [])[:5]):
        kind = q.get("kind") if q.get("kind") in PROBE_KINDS else "single"
        opts = [str(o) for o in (q.get("options") or [])][:7]
        if q.get("text") and (opts or kind == "text"):
            qs.append({"id": str(q.get("id") or f"q{i + 1}"), "kind": kind, "text": str(q["text"]), "options": opts,
                       "purpose": str(q.get("purpose") or "")})
    return {"chapter": opt["title"], "questions": qs}


def reader_text(reader) -> str:
    """The reader notes the planner gets: the reader's own line, then each probe question with its purpose and the
    answer. Accepts a plain string too."""
    if not reader:
        return ""
    if isinstance(reader, str):
        return reader.strip()
    lines = []
    if str(reader.get("note") or "").strip():
        lines.append(f"In the reader's own words: {reader['note'].strip()}")
    answers = [a for a in reader.get("answers") or [] if a.get("answer")]
    if answers:
        lines.append("Their answers to questions about this chapter:")
        for a in answers:
            ans = a["answer"] if isinstance(a["answer"], str) else ", ".join(map(str, a["answer"]))
            lines.append(f"- {a.get('question', '')} -> {ans}" + (f"  [{a['purpose']}]" if a.get("purpose") else ""))
    return "\n".join(lines)


def start_job(upload_id: str, selector: str, options: dict | None = None) -> dict:
    up = get_upload(upload_id)
    opt = next((c for c in up["chapters"] if c["selector"] == selector), None)
    if not opt:
        raise KeyError(f"no chapter {selector!r} in upload {upload_id}")
    options = options or {}
    cfg = load_config()
    nodes = {k: dict(v) for k, v in cfg["nodes"].items()}
    if options.get("write_model"):
        nodes["write"]["model"] = nodes["fix"]["model"] = options["write_model"]
    if options.get("plan_model"):
        nodes["plan"]["model"] = options["plan_model"]
    if options.get("write_thinking") is not None:
        nodes["write"]["thinking"] = bool(options["write_thinking"])
    if options.get("dry_run"):
        install_dry_run()
        for n in nodes.values():
            n["provider"] = "replay"
    jid = _id()
    job = JOBS / jid
    job.mkdir(parents=True)
    num = re.match(r"^(?:chapter\s+)?(\d+)", opt["title"], re.I)
    # an unnumbered outline (OSTEP) gets its number in run_job, from the page (slow on a big PDF)
    position = up["chapters"].index(opt) + 1 if not num and selector != "__all__" else None
    spec = {"id": jid, "upload": upload_id, "file": up["name"], "chapter": selector, "chapter_title": opt["title"],
            "chapter_id": num.group(1) if num else None, "chapter_position": position, "nodes": nodes,
            "budget": float(options.get("budget") or cfg["run"]["budget_usd"]),
            "max_fix": int(options.get("max_fix") if options.get("max_fix") is not None else cfg["run"]["max_fix_rounds"]),
            "reader": reader_text(options.get("reader")), "started": time.time()}
    (job / "job.json").write_text(json.dumps(spec, indent=1, ensure_ascii=False), encoding="utf-8")
    set_status(job, stage="queued")
    t = threading.Thread(target=run_job, args=(job, spec, cfg["run"].get("max_concurrency", 12)), daemon=True, name=f"job-{jid}")
    _threads[jid] = t
    t.start()
    return spec


def install_dry_run() -> None:
    """Stub replies for every node, so a job can run the whole graph without an API key or cost."""
    from pipeline.llm import core

    def write(c):
        m = re.search(r'Front matter: id "([^"]+)", title "([^"]*)"', c.user)
        sid, title = (m.group(1), m.group(2)) if m else ("1", "Section")
        return (f'---\nid: "{sid}"\ntitle: "{title}"\n---\nDry run: no model was called, so this section only shows that the '
                "pipeline ran end to end.\n\n:::quiz\n? Was a model called?\n- Yes\n+ No, this is a dry run\n> Stub reply.\n:::\n")
    core.REPLAY.update({
        "digest": lambda c: json.dumps({"summary": "dry run", "points": ["(stub)"], "examples": [], "terms": [], "artifacts": {},
                                        "visual_ideas": ["a diagram of the mechanism"], "quiz_ideas": [], "difficulty": "medium"}),
        "plan": lambda c: json.dumps({"chapter_summary": "dry run", "sections": [
            {"chunk": cid, "brief": "Dry run brief.", "skills": ["faithful-coverage"], "visuals": [], "clarification": None,
             "expect": {"visual_min": 0, "quiz_min": 1}} for cid in re.findall(r"^### (c\d+)", c.user, re.M)]}),
        "write": write,
        "fix": lambda c: '{"edits": []}',
        "judge": lambda c: json.dumps({"faithful": 1, "clear": 1, "visual": 1, "interactive": 1, "polish": 1, "overall": 1,
                                       "reasons": {"faithful": "dry run"}, "top_fix": "run with a real model"}),
    })


def run_job(job: Path, spec: dict, concurrency: int) -> None:
    try:
        if spec.get("chapter_id") is None and spec.get("chapter_position"):
            # an unnumbered outline (OSTEP): the number printed above the title, else the chapter's position. Done here,
            # not in start_job: reading a big PDF made the start request time out and a retry start a second job
            opt = next((c for c in get_upload(spec["upload"])["chapters"] if c["selector"] == spec["chapter"]), None)
            found = printed_number(UPLOADS / spec["upload"] / "file.pdf", opt) if opt else None
            spec["chapter_id"] = found or str(spec["chapter_position"])
            (job / "job.json").write_text(json.dumps(spec, indent=1, ensure_ascii=False), encoding="utf-8")
        build_graph().invoke({"job_dir": str(job), "pdf": str(UPLOADS / spec["upload"] / "file.pdf"), "title": spec["file"],
                              "chapter": spec["chapter"], "chapter_id": spec.get("chapter_id"), "nodes": spec["nodes"],
                              "max_fix": spec["max_fix"], "budget": spec["budget"], "reader": spec.get("reader", "")},
                             {"max_concurrency": concurrency, "recursion_limit": 200})
    except Exception as e:  # noqa: BLE001
        (job / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        set_status(job, stage="error", error=f"{type(e).__name__}: {e}")
        emit(job, "error", f"{type(e).__name__}: {e}", level="error")
    finally:
        set_status(job, finished=time.time())


def _read(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def job_status(jid: str) -> dict:
    job = JOBS / jid
    spec = _read(job / "job.json")
    if spec is None:
        raise KeyError(jid)
    status = _read(job / "status.json", {})
    events = [json.loads(l) for l in (job / "events.jsonl").read_text(encoding="utf-8").splitlines()] if (job / "events.jsonl").exists() else []
    rows = read_ledger(job / "ledger.jsonl")
    by_node: dict = defaultdict(lambda: {"calls": 0, "input": 0, "cache_hit": 0, "output": 0, "reasoning": 0, "cost_usd": 0.0, "latency_s": 0.0})
    for r in rows:
        n = by_node[r["node"]]
        n["calls"] += 1
        for k in ("input", "cache_hit", "output", "reasoning"):
            n[k] += r.get(k, 0)
        n["cost_usd"] = round(n["cost_usd"] + r.get("cost_usd", 0), 6)
        n["latency_s"] = round(n["latency_s"] + r.get("latency_s", 0), 1)
    totals = {k: sum(v[k] for v in by_node.values()) for k in ("calls", "input", "cache_hit", "output", "reasoning")}
    totals["cost_usd"] = round(sum(v["cost_usd"] for v in by_node.values()), 5)
    # per chunk: what has happened so far
    chunks = []
    for c in status.get("chunks", []):
        cid = c["id"]
        evs = [e for e in events if e.get("chunk") == cid]
        sec = _read(job / "sections" / cid / "out" / "w.score.json")
        jd = _read(job / "sections" / cid / "judge.json")
        state = "waiting"
        if any(e["stage"] == "digest" for e in evs):
            state = "digested"
        if any(e["stage"] == "write" for e in evs):
            state = "writing"
        last_write = next((e for e in reversed(evs) if e["stage"] == "write"), None)
        if last_write and last_write["msg"] != "writing":
            state = "error" if last_write.get("level") == "error" else ("pass" if sec and sec.get("pass") else "fail")
        versions = len(list((job / "sections" / cid / "out").glob("w.v*.md"))) if (job / "sections" / cid / "out").exists() else 0
        cost = round(sum(r["cost_usd"] for r in rows if r.get("tag") == cid), 5)
        chunks.append({**c, "state": state, "versions": versions, "score": sec and sec.get("score"), "pass": sec and sec.get("pass"),
                       "judge": jd and {**{k: jd.get(k) for k in ("faithful", "clear", "visual", "interactive", "polish", "overall", "error")},
                                        "corrected": (jd.get("correction") or {}).get("errors") if (jd.get("correction") or {}).get("applied") and not (jd.get("correction") or {}).get("reverted") else 0,
                                        "errors_left": len(jd.get("errors") or [])},
                       "cost_usd": cost, "digested": (job / "digests" / f"{cid}.json").exists()})
    built = _read(job / "page" / "build.json")
    page = built and {**built, "url": f"/read/upload-{spec.get('upload')}/{run_chapter_id({'id': jid, **spec})}/" if (job / "page" / "dist" / "index.html").exists() else None}
    return {"job": spec, "status": status, "events": events[-300:], "nodes": by_node, "totals": totals, "chunks": chunks,
            "page": page, "running": jid in _threads and _threads[jid].is_alive()}


def list_jobs() -> list[dict]:
    if not JOBS.exists():
        return []
    out = []
    for d in JOBS.iterdir():
        spec, st = _read(d / "job.json"), _read(d / "status.json", {})
        if spec:
            cost = round(sum(r.get("cost_usd", 0) for r in read_ledger(d / "ledger.jsonl")), 5)
            out.append({"id": spec["id"], "file": spec["file"], "chapter": spec["chapter_title"], "stage": st.get("stage"),
                        "started": spec["started"], "cost_usd": cost})
    return sorted(out, key=lambda j: -j["started"])


def section_detail(jid: str, cid: str) -> dict:
    job = JOBS / jid
    d = job / "sections" / cid
    if not (job / "job.json").exists() or not re.fullmatch(r"c\d+", cid):
        raise KeyError(cid)
    md = (d / "out" / "w.md").read_text(encoding="utf-8") if (d / "out" / "w.md").exists() else None
    score = _read(d / "out" / "w.score.json")
    plan = _read(job / "plan.json", {})
    return {"chunk": cid, "markdown": md, "versions": sorted(p.name for p in (d / "out").glob("w.v*.md")) if (d / "out").exists() else [],
            "score": score and {k: score.get(k) for k in ("pass", "score", "must", "should", "issues", "metrics")},
            "judge": _read(d / "judge.json"), "digest": _read(job / "digests" / f"{cid}.json"),
            "plan": next((s for s in plan.get("sections", []) if s.get("chunk") == cid), None),
            "error": (d / "error.txt").read_text(encoding="utf-8")[-2000:] if (d / "error.txt").exists() else None}
