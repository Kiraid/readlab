"""One chapter through the whole pipeline, as a LangGraph graph.

    ingest ─► digest × N ─► plan ─► section × N ─────────────────────────────► build ─► finalize
    (code)    (parallel)    (1 call) (parallel: write ─► validate ─► fix ─► …     (page)   (report)
                                      ─► judge ─► correct what it flags ─► judge again)

Nothing here is an "agent" that decides to call another agent. Every model call is one request with a fixed
input and a fixed output shape, and the graph (code) decides what runs next: fan-outs are LangGraph `Send`s
(one branch per chunk, run in parallel up to max_concurrency), barriers wait for all branches, and the fix loop
is driven by the validator's verdict.

Everything a job produces lives in its folder (book text, so under sources/, never committed):
  ingest/             extraction output (extract.json, sections/, chunks/, files/)
  chunks/<cid>.json   what each chunk's calls see
  digests/<cid>.json  digest per chunk
  plan.json           the planner's briefs
  sections/<cid>/     case.yaml, source.json, files/, prompt.json, out/w.v<N>.md + score, judge.json
  chapter/*.md        the final section files, in order
  page/               the chapter page: chapter.yaml, sections/, files/, dist/index.html, build.json
  events.jsonl        progress, one line per step;  ledger.jsonl  every model call with tokens and cost
  status.json         stage + counts (what the API reports);  report.json  the summary at the end
"""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import traceback
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, TypedDict

import yaml
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from pipeline.harness.page import build_page
from pipeline.harness.section import build_graph as build_section_graph
from pipeline.harness.section import correct as section_correct
from pipeline.harness.section import fix as section_fix
from pipeline.harness.section import validate as section_validate
from pipeline.ingest.auto import auto_book_config
from pipeline.ingest.run import ingest_chapter
from pipeline.llm import Call, call
from pipeline.llm.core import read_ledger
from pipeline.prompts.assemble import digest_prompt, judge_prompt, plan_prompt, writer_prompt

_lock = threading.Lock()


def _merge(a: dict | None, b: dict | None) -> dict:
    return {**(a or {}), **(b or {})}


class ChapterState(TypedDict, total=False):
    job_dir: str
    pdf: str
    title: str
    chapter: str
    chapter_id: str | None
    nodes: dict
    max_fix: int
    budget: float
    reader: str          # who the page is for: the reader's answers to the probe, or empty for the default reader
    chunks: list
    chapter_meta: dict
    digests: Annotated[dict, _merge]
    plan: dict
    sections: Annotated[dict, _merge]
    judges: Annotated[dict, _merge]
    page: dict
    chunk: dict          # set only inside a fan-out branch


class BudgetExceeded(RuntimeError):
    pass


# ---------------------------------------------------------------- job bookkeeping

def emit(job_dir: str | Path, stage: str, msg: str, **data) -> None:
    job = Path(job_dir)
    row = {"ts": time.time(), "stage": stage, "msg": msg, **data}
    with _lock:
        with (job / "events.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def set_status(job_dir: str | Path, **changes) -> None:
    p = Path(job_dir) / "status.json"
    with _lock:
        cur = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        cur.update(changes)
        cur["updated"] = time.time()
        p.write_text(json.dumps(cur, indent=1), encoding="utf-8")


def spent(job_dir: str | Path) -> float:
    return sum(r.get("cost_usd", 0) for r in read_ledger(Path(job_dir) / "ledger.jsonl"))


def _check_budget(state: ChapterState) -> None:
    if spent(state["job_dir"]) >= state.get("budget", 2.0):
        raise BudgetExceeded(f"budget ${state.get('budget')} reached")


def _ask(state: ChapterState, node: str, prompt: dict, tag: str, json_mode: bool = False):
    _check_budget(state)
    cfg = state["nodes"][node]
    return call(Call(node=node, provider=cfg["provider"], model=cfg["model"], system=prompt["system"], user=prompt["user"],
                     thinking=cfg.get("thinking", True), max_tokens=cfg.get("max_tokens", 8000), json_mode=json_mode, tag=tag),
                ledger=Path(state["job_dir"]) / "ledger.jsonl")


def parse_json(text: str) -> dict:
    """Models in JSON mode return JSON, but strip a code fence or stray text around the object just in case, and
    drop trailing commas (`"x": 1, }`), the one slip seen in practice (a judge reply, KiA/Rust runs 2026-11-07)."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    a, b = t.find("{"), t.rfind("}")
    for cand in (t, t[a:b + 1] if 0 <= a < b else t):
        for c in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):
            try:
                return json.loads(c)
            except json.JSONDecodeError:
                pass
    return json.loads(t)  # raise the original error


def salvage_plan(text: str) -> dict:
    """A planner reply cut off at its token limit (DBI ch5, 21 chunks, 2026-11-07) is a valid JSON prefix: keep
    the chapter summary and every section brief that arrived whole."""
    dec = json.JSONDecoder()
    out: dict = {"chapter_summary": "", "sections": []}
    m = re.search(r'"chapter_summary"\s*:\s*', text)
    if m:
        try:
            out["chapter_summary"] = dec.raw_decode(text, m.end())[0]
        except json.JSONDecodeError:
            pass
    m = re.search(r'"sections"\s*:\s*\[', text)
    i = m.end() if m else len(text)
    while i < len(text):
        while i < len(text) and text[i] in " \t\r\n,":
            i += 1
        if i >= len(text) or text[i] != "{":
            break
        try:
            obj, i = dec.raw_decode(text, i)
        except json.JSONDecodeError:
            break  # the brief that was cut off
        if isinstance(obj, dict):
            out["sections"].append(obj)
    return out


# ---------------------------------------------------------------- nodes

def ingest(state: ChapterState) -> ChapterState:
    job = Path(state["job_dir"])
    set_status(job, stage="ingest")
    emit(job, "ingest", "extracting text, finding sections and chunking")
    cfg = auto_book_config(Path(state["pdf"]), job / "ingest", state.get("title") or Path(state["pdf"]).stem)
    r = ingest_chapter(cfg, state["chapter"], state.get("chapter_id"))
    files_dir = r["out"] / "files"
    chunks = []
    for obj, row in zip(r["chunk_objs"], r["chunks"]):
        blocks, last = [], None
        for p in obj.parts:
            if last is not None and p.section.id != last:
                blocks.append({"kind": "subheading", "text": p.section.title, "page": p.blocks[0].page if p.blocks else 0,
                               "top": 0.0, "bottom": 0.0, "x0": 0.0, "size": 0.0, "meta": {}})
            last = p.section.id
            blocks.extend(asdict(b) for b in p.blocks)
        files = {}
        for b in blocks:
            name = b["meta"].get("saved_as")
            if b["kind"] == "code" and name and (files_dir / name).exists():
                files[name] = (files_dir / name).read_text(encoding="utf-8").rstrip("\n")
        prose = " ".join(b["text"] for b in blocks if b["kind"] in ("para", "item", "callout"))
        chunks.append({"id": row["id"], "sections": row["sections"], "title": obj.parts[0].section.title,
                       "first_section": obj.parts[0].section.id, "blocks": blocks, "features": row["features"],
                       "files": files, "est_tokens": row["est_tokens"], "prose_words": len(prose.split()),
                       "tables": sum(1 for b in blocks if b["kind"] == "table"), "tier": row.get("tier")})
    (job / "chunks").mkdir(exist_ok=True)
    for c in chunks:
        (job / "chunks" / f"{c['id']}.json").write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")
    rng = r["range"]
    meta = {"id": rng.id, "title": rng.chapter.name,
            "sections": [{"id": s.id, "title": s.title} for s in r["sections"]]}
    (job / "chapter.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    set_status(job, stage="digest", chapter=meta, chunks=[{"id": c["id"], "sections": c["sections"], "title": c["title"],
                                                          "tokens": c["est_tokens"], "words": c["prose_words"]} for c in chunks])
    emit(job, "ingest", f"{len(r['sections'])} sections in {len(chunks)} chunks", warnings=r["warnings"])
    return {"chunks": chunks, "chapter_meta": meta}


def fan_digest(state: ChapterState):
    return [Send("digest", {**_branch(state), "chunk": c}) for c in state["chunks"]]


def _branch(state: ChapterState) -> dict:
    return {k: state[k] for k in ("job_dir", "nodes", "max_fix", "budget") if k in state}


def digest(state: ChapterState) -> ChapterState:
    c = state["chunk"]
    job = Path(state["job_dir"])
    try:
        res = _ask(state, "digest", digest_prompt(c), tag=c["id"], json_mode=True)
        d = parse_json(res.text)
        msg = f"{len(d.get('points', []))} points, {len(d.get('visual_ideas', []))} visual ideas"
    except Exception as e:  # noqa: BLE001 - a failed digest leaves the planner with less to go on, not a dead job
        d = {"error": f"{type(e).__name__}: {e}"}
        msg = d["error"]
    (job / "digests").mkdir(exist_ok=True)
    (job / "digests" / f"{c['id']}.json").write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    emit(job, "digest", msg, chunk=c["id"])
    return {"digests": {c["id"]: d}}


def plan(state: ChapterState) -> ChapterState:
    job = Path(state["job_dir"])
    set_status(job, stage="plan")
    emit(job, "plan", "planning the chapter from the digests")
    chunks = state["chunks"]
    res = None
    try:
        res = _ask(state, "plan", plan_prompt(state["chapter_meta"], chunks, state.get("digests", {}), state.get("reader")),
                   tag="chapter", json_mode=True)
        p = parse_json(res.text)
    except Exception as e:  # noqa: BLE001
        p = salvage_plan(res.text) if res is not None else {"sections": []}
        p["error"] = f"{type(e).__name__}: {e}"
        emit(job, "plan", f"planner reply unreadable ({'cut off at its token limit' if res is not None and res.finish_reason == 'length' else p['error']}); "
                          f"kept {len(p['sections'])} complete brief(s), the rest fall back to the digests")
    by_chunk = {s.get("chunk"): s for s in p.get("sections", []) if isinstance(s, dict)}
    entries = []
    for c in chunks:  # every chunk gets a brief, even if the planner skipped it
        d = state.get("digests", {}).get(c["id"], {})
        e = by_chunk.get(c["id"]) or {"chunk": c["id"], "title": c["title"], "brief": d.get("summary", "Retell this chunk faithfully."),
                                      "skills": ["faithful-coverage"], "visuals": d.get("visual_ideas", [])[:1], "clarification": None,
                                      "expect": {"visual_min": 0, "quiz_min": 1}, "fallback": True}
        entries.append(e)
    p["sections"] = entries
    (job / "plan.json").write_text(json.dumps(p, indent=1, ensure_ascii=False), encoding="utf-8")
    set_status(job, stage="write")
    emit(job, "plan", f"{len(entries)} briefs" + (f" ({sum(1 for e in entries if e.get('fallback'))} fallback)" if any(e.get('fallback') for e in entries) else ""))
    return {"plan": p}


DESIGN_KEYS = ("reader", "goal", "running_example", "misconceptions", "layers_down", "mechanisms")


def fan_sections(state: ChapterState):
    briefs = {e["chunk"]: e for e in state["plan"]["sections"]}
    design = {k: state["plan"].get(k) for k in DESIGN_KEYS}  # every writer sees the chapter-level decisions
    return [Send("section", {**_branch(state), "chunk": {**c, "plan": briefs.get(c["id"], {}), "design": design}})
            for c in state["chunks"]]


def brief_text(e: dict, design: dict | None = None) -> str:
    """The writer's brief: the chapter-level design (shared by every section, so independently written sections
    build on the same reader, goal and example) and then this section's part of it."""
    design = design or {}
    cid = e.get("chunk")
    mine = lambda key: [x for x in (design.get(key) or []) if isinstance(x, dict) and x.get("chunk") == cid]  # noqa: E731
    lines = []
    if design.get("reader"):
        lines.append(f"The reader: {design['reader']}")
    if design.get("goal"):
        lines.append(f"The chapter's goal: {design['goal']}")
    ex = design.get("running_example")
    if isinstance(ex, dict) and ex.get("what"):
        use = "use it for this section's concrete case" if cid in (ex.get("chunks") or []) else "reuse it only where it helps"
        lines.append(f"Running example shared across the chapter: {ex.get('name', '')}: {ex['what']} ({use}).")
    lines += ["", f"This section's role: {e['role']}." if e.get("role") else "", str(e.get("brief", "")).strip()]
    teach = e.get("teach") or {}
    for m in mine("misconceptions"):
        lines.append(f"Confront this misconception (clarify-misconception): \"{m.get('wrong')}\"; the right idea: {m.get('right')}")
    if teach.get("misconception") and not mine("misconceptions"):
        lines.append(f"Confront this misconception (clarify-misconception): {teach['misconception']}")
    for l in mine("layers_down"):
        lines.append(f"One layer down (`:::callout underneath`): {l.get('concept')}: {l.get('beneath')}")
    if teach.get("underneath") and not mine("layers_down"):
        lines.append(f"One layer down (`:::callout underneath`): {teach['underneath']}")
    if teach.get("example"):
        lines.append(f"An example of your own (`:::callout example`): {teach['example']}")
    if teach.get("analogy"):
        lines.append(f"An analogy (`:::callout analogy`, say where it stops working): {teach['analogy']}")
    for m in mine("mechanisms"):
        lines.append(f"Build for the reader to work through: {m.get('name')}: {m.get('build')}")
    if e.get("skills"):
        lines.append("Skills to apply: " + ", ".join(e["skills"]) + ".")
    lines.append("Visuals: " + "; ".join(str(v) for v in e["visuals"]) + "." if e.get("visuals")
                 else "Visuals: none needed beyond the source's own figures, listings, commands and tables.")
    if e.get("clarification"):
        lines.append("Clarify: " + str(e["clarification"]))
    lines.append("Length: your retelling is about 80-130% of the source's prose; labelled callouts, quizzes and recaps don't count.")
    return "\n".join(lines).strip()


def section(state: ChapterState) -> ChapterState:
    """Write one chunk's section: build its case folder, then run the write -> validate -> fix graph."""
    c = state["chunk"]
    job = Path(state["job_dir"])
    e = c.get("plan", {})
    d = job / "sections" / c["id"]
    if d.exists():
        shutil.rmtree(d)
    (d / "files").mkdir(parents=True)
    for name, text in c["files"].items():
        (d / "files" / name).write_text(text + "\n", encoding="utf-8")
    sec = {"id": c["first_section"], "title": e.get("title") or c["title"], "blocks": c["blocks"], "features": c["features"]}
    brief = brief_text(e, c.get("design"))
    expect = {k: v for k, v in (e.get("expect") or {}).items() if k in ("visual_min", "quiz_min", "terminal_min")}
    (d / "case.yaml").write_text(yaml.safe_dump({"id": c["id"], "title": sec["title"], "shell": "basic", "brief": brief, "expect": expect},
                                                 sort_keys=False, allow_unicode=True), encoding="utf-8")
    (d / "source.json").write_text(json.dumps({"sections": [sec]}, ensure_ascii=False), encoding="utf-8")
    prompt = writer_prompt(sec, c["files"], "basic", brief)
    (d / "prompt.json").write_text(json.dumps(prompt, ensure_ascii=False), encoding="utf-8")
    emit(job, "write", "writing", chunk=c["id"])
    try:
        _check_budget(state)
        final = build_section_graph().invoke({"case_dir": str(d), "run": "w", "tag": c["id"], "system": prompt["system"],
                                              "user": prompt["user"], "nodes": state["nodes"], "max_fix": state.get("max_fix", 2),
                                              "ledger": str(job / "ledger.jsonl")}, {"recursion_limit": 20})
        s = final["score"]
        out = {**_section_out(s, brief), "fixes": final.get("fixes", 0)}
        _publish(job, c, d)
        emit(job, "write", f"{'pass' if s['pass'] else 'fail'} · score {s['score']} · {out['fixes']} fix round(s)", chunk=c["id"])
    except Exception as ex:  # noqa: BLE001
        out = {"pass": False, "error": f"{type(ex).__name__}: {ex}", "brief": brief}
        emit(job, "write", out["error"], chunk=c["id"], level="error")
        if not isinstance(ex, BudgetExceeded):
            (d / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        return {"sections": {c["id"]: out}}
    # judged right away, in this branch: no waiting for the slowest section before any judging starts; then the
    # errors the judge lists (a wrong quiz key, an example whose numbers don't work) are corrected
    j = judge(state)["judges"][c["id"]]
    out, j = correct_section(state, d, prompt, final, j, out, brief)
    return {"sections": {c["id"]: out}, "judges": {c["id"]: j}}


def _section_out(s: dict, brief: str) -> dict:
    m = s["metrics"]
    return {"pass": s["pass"], "score": s["score"], "must": s["must"], "words": m.get("retell_words") or m.get("words"),
            "source_words": m.get("source_words"), "coverage": m.get("coverage"), "warnings": m.get("warnings", []),
            "uses": {k: m.get(k) for k in ("diagrams", "widgets", "quizzes", "terminals", "code", "callouts", "tables")},
            "own_callouts": m.get("own_callouts", 0), "widget_names": m.get("widget_names", []), "brief": brief}


def _publish(job: Path, c: dict, d: Path) -> None:
    (job / "chapter").mkdir(exist_ok=True)
    shutil.copy(d / "out" / "w.md", job / "chapter" / f"{int(c['id'].lstrip('c') or 0):02d}-{c['id']}.md")


SCORE_KEYS = ("faithful", "clear", "visual", "interactive", "polish", "overall")


def correct_section(state: ChapterState, d: Path, prompt: dict, final: dict, j: dict, out: dict, brief: str) -> tuple[dict, dict]:
    """One correction round for the errors the judge listed, then re-check and re-judge. A correction that breaks
    a section that passed its checks (and one fix round doesn't repair) is reverted. One round only: errors the
    second judge still finds stay in its report."""
    c, job = state["chunk"], Path(state["job_dir"])
    errors = [e for e in (j.get("errors") or []) if isinstance(e, dict) and str(e.get("problem", "")).strip()][:8]
    if not errors:
        return out, j
    emit(job, "correct", f"judge found {len(errors)} error(s); correcting", chunk=c["id"])
    try:
        _check_budget(state)
        st = {"case_dir": str(d), "run": "w", "tag": c["id"], "system": prompt["system"], "user": prompt["user"],
              "nodes": state["nodes"], "ledger": str(job / "ledger.jsonl"), "history": list(final.get("history", [])),
              "draft": (d / "out" / "w.md").read_text(encoding="utf-8"), "version": final.get("version", 0), "fixes": 0, "max_fix": 1}
        before = st["draft"]
        st.update(section_correct(st, errors))
        if st["draft"] == before:
            j["correction"] = {"errors": len(errors), "applied": False, "note": "no edit could be applied"}
            emit(job, "correct", "no correction could be applied", chunk=c["id"])
            (d / "judge.json").write_text(json.dumps(j, indent=1, ensure_ascii=False), encoding="utf-8")
            return out, j
        st.update(section_validate(st))
        if not st["score"]["pass"]:
            st.update(section_fix(st))
            st.update(section_validate(st))
        if final["score"]["pass"] and not st["score"]["pass"]:
            (d / "out" / "w.md").write_text(before, encoding="utf-8")
            section_validate({**st, "draft": before})  # the score file follows the restored draft
            j["correction"] = {"errors": len(errors), "applied": True, "reverted": True, "note": "the correction broke the checks"}
            emit(job, "correct", "correction reverted: it broke the checks", chunk=c["id"])
            (d / "judge.json").write_text(json.dumps(j, indent=1, ensure_ascii=False), encoding="utf-8")
            return out, j
        out = {**_section_out(st["score"], brief), "fixes": out.get("fixes", 0), "corrected": len(errors)}
        _publish(job, c, d)
        j2 = judge(state)["judges"][c["id"]]
        left = len(j2.get("errors") or [])
        j2["correction"] = {"errors": len(errors), "applied": True, "fixed": errors, "before": {k: j.get(k) for k in SCORE_KEYS},
                            "errors_left": left}
        (d / "judge.json").write_text(json.dumps(j2, indent=1, ensure_ascii=False), encoding="utf-8")
        emit(job, "correct", f"corrected {len(errors)} error(s); judge {j.get('overall')} -> {j2.get('overall')}"
                             + (f", {left} still flagged" if left else ""), chunk=c["id"])
        return out, j2
    except Exception as ex:  # noqa: BLE001  (budget, provider): the section stays as it was
        j["correction"] = {"errors": len(errors), "applied": False, "note": f"{type(ex).__name__}: {ex}"}
        emit(job, "correct", f"correction skipped: {type(ex).__name__}: {ex}", chunk=c["id"], level="error")
        return out, j


def judge(state: ChapterState) -> ChapterState:
    c = state["chunk"]
    job = Path(state["job_dir"])
    d = job / "sections" / c["id"]
    try:
        written = (d / "out" / "w.md").read_text(encoding="utf-8")
        score = json.loads((d / "out" / "w.score.json").read_text(encoding="utf-8"))
        case = yaml.safe_load((d / "case.yaml").read_text(encoding="utf-8"))
        sec = json.loads((d / "source.json").read_text(encoding="utf-8"))["sections"][0]
        res = _ask(state, "judge", judge_prompt(sec, case["brief"], written, score["issues"]), tag=c["id"], json_mode=True)
        j = parse_json(res.text)
        msg = f"overall {j.get('overall')} · faithful {j.get('faithful')} · visual {j.get('visual')}"
    except Exception as e:  # noqa: BLE001
        j = {"error": f"{type(e).__name__}: {e}"}
        msg = j["error"]
    (d / "judge.json").write_text(json.dumps(j, indent=1, ensure_ascii=False), encoding="utf-8")
    emit(job, "judge", msg, chunk=c["id"])
    return {"judges": {c["id"]: j}}


def build(state: ChapterState) -> ChapterState:
    """Assemble the written sections into one chapter page (pipeline/harness/page.py). No model."""
    job = Path(state["job_dir"])
    set_status(job, stage="build")
    try:
        r = build_page(job)
        msg = f"page built: {r['sections']} sections" + (f", {len(r['errors'])} build error(s)" if r["errors"] else "")
        emit(job, "build", msg, **({"level": "error"} if not r["ok"] else {}))
    except Exception as e:  # noqa: BLE001
        r = {"ok": False, "errors": [f"{type(e).__name__}: {e}"]}
        emit(job, "build", f"page build failed: {r['errors'][0]}", level="error")
    return {"page": r}


def finalize(state: ChapterState) -> ChapterState:
    job = Path(state["job_dir"])
    rows = read_ledger(job / "ledger.jsonl")
    report = {"chapter": state.get("chapter_meta"), "sections": state.get("sections", {}), "judges": state.get("judges", {}),
              "page": state.get("page"), "cost_usd": round(sum(r["cost_usd"] for r in rows), 5), "calls": len(rows)}
    (job / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    set_status(job, stage="done")
    emit(job, "done", f"finished: {sum(1 for s in report['sections'].values() if s.get('pass'))}/{len(report['sections'])} pass · ${report['cost_usd']:.4f}")
    return {}


def build_graph():
    g = StateGraph(ChapterState)
    for name, fn in [("ingest", ingest), ("digest", digest), ("plan", plan), ("section", section), ("build", build),
                     ("finalize", finalize)]:
        g.add_node(name, fn)
    g.add_edge(START, "ingest")
    g.add_conditional_edges("ingest", fan_digest, ["digest"])
    g.add_edge("digest", "plan")
    g.add_conditional_edges("plan", fan_sections, ["section"])
    g.add_edge("section", "build")
    g.add_edge("build", "finalize")
    return g.compile()
