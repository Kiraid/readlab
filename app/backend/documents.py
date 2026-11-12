"""Documents (books and articles), their chapters, covers, reading progress, and the chapter pages themselves.

Everything is private to its owner, admins included: a document someone else uploaded is a 404.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from pipeline.harness import jobs as harness_jobs
from pipeline.llm import load_config

from . import config, pdfmeta
from .auth import current_user
from .db import get_db
from .models import Chapter, Document, Job, ReadingProgress, User
from .queue import enqueue, label_of, new_id, queue_position, words_used

router = APIRouter(tags=["documents"])
MAX_UPLOAD = 120 * 1024 * 1024
WPM = 220  # reading speed for the time estimates
ARTICLE_MAX_PAGES = 40
ACTIVE = ("queued", "running")
BRIDGE = Path(__file__).parent / "static" / "reader-bridge.js"


# ---------------------------------------------------------------- serialisation

def cover_url(d: Document) -> str | None:
    return f"/api/documents/{d.id}/cover?v={int(d.updated_at.timestamp()) if d.updated_at else 0}" if d.has_cover else None


def minutes(words: int) -> int:
    return max(1, round(words / WPM)) if words else 0


def progress_json(p: ReadingProgress | None) -> dict | None:
    if not p:
        return None
    return {"part": p.part, "anchor": p.anchor, "offset": p.offset, "percent": round(p.percent, 4),
            "furthest": round(p.furthest, 4), "updated_at": p.updated_at.isoformat()}


def job_brief(db: Session, j: Job | None) -> dict | None:
    if not j:
        return None
    return {"id": j.id, "status": j.status, "stage": j.stage, "label": label_of(j.stage), "progress": round(j.progress, 3),
            "position": queue_position(db, j), "queued_at": j.queued_at.isoformat(), "error": j.error if j.status == "failed" else None}


def chapter_json(db: Session, c: Chapter, prog: ReadingProgress | None = None, job: Job | None = None, full: bool = False) -> dict:
    words = (c.stats or {}).get("words") or 0
    out = {"id": c.id, "document_id": c.document_id, "position": c.position, "number": c.number, "title": c.title,
           "pages": [c.page_start, c.page_end], "sections": c.section_count, "source_words": c.words,
           "minutes": minutes(words) if c.status == "ready" else minutes(c.words), "status": c.status,
           "summary": c.summary, "stats": c.stats or {}, "part_count": len(c.parts or []),
           "ready_at": c.ready_at.isoformat() if c.ready_at else None,
           "progress": progress_json(prog), "job": job_brief(db, job)}
    if full:
        out["parts"] = c.parts or []
    return out


def document_json(d: Document, chapters: list[Chapter] | None = None, progress: dict | None = None) -> dict:
    chs = chapters if chapters is not None else d.chapters
    read = [progress[c.id] for c in chs if progress and c.id in progress]
    return {"id": d.id, "kind": d.kind, "title": d.title, "subtitle": d.subtitle, "authors": d.authors or [], "edition": d.edition,
            "blurb": d.blurb, "accent": d.accent, "pages": d.pages, "words": d.words, "cover": cover_url(d), "source": d.source,
            "filename": d.filename, "created_at": d.created_at.isoformat(), "updated_at": d.updated_at.isoformat(),
            "chapter_count": len(chs), "ready_count": sum(c.status == "ready" for c in chs),
            "generating_count": sum(c.status in ACTIVE for c in chs),
            "read_percent": round(sum(p.furthest for p in read) / max(1, sum(c.status == "ready" for c in chs)), 4) if read else 0,
            "last_read_at": max((p.updated_at for p in read), default=None) and max(p.updated_at for p in read).isoformat()}


def owned_doc(db: Session, doc_id: str, user: User) -> Document:
    d = db.get(Document, doc_id)
    if not d or d.owner_id != user.id:
        raise HTTPException(404, "no such document")
    return d


def owned_chapter(db: Session, chapter_id: int, user: User) -> Chapter:
    c = db.get(Chapter, chapter_id)
    if not c or c.document.owner_id != user.id:
        raise HTTPException(404, "no such chapter")
    return c


def _progress_map(db: Session, user: User, chapter_ids: list[int]) -> dict[int, ReadingProgress]:
    if not chapter_ids:
        return {}
    rows = db.scalars(select(ReadingProgress).where(ReadingProgress.user_id == user.id, ReadingProgress.chapter_id.in_(chapter_ids)))
    return {p.chapter_id: p for p in rows}


def _active_jobs(db: Session, chapter_ids: list[int]) -> dict[int, Job]:
    if not chapter_ids:
        return {}
    rows = db.scalars(select(Job).where(Job.chapter_id.in_(chapter_ids), Job.status.in_(ACTIVE)).order_by(Job.queued_at))
    return {j.chapter_id: j for j in rows}


# ---------------------------------------------------------------- upload

def analyse(pdf: Path, folder: Path, filename: str, kind: str) -> dict:
    """Everything the library needs from a new PDF. Runs in a thread: a 600-page book takes a few seconds."""
    texts = pdfmeta.page_texts(pdf)
    meta = pdfmeta.guess_meta(pdf, filename)
    try:
        accent = pdfmeta.render_cover(pdf, folder / "cover.webp")
    except Exception:  # noqa: BLE001  (an odd first page should not stop the upload)
        accent = None
    options = harness_jobs.chapter_options(pdf, folder)
    old = folder / "meta.json"  # the harness reads this file; an imported upload keeps its upload time
    uploaded = json.loads(old.read_text(encoding="utf-8")).get("uploaded") if old.exists() else None
    old.write_text(json.dumps({"id": folder.name, "name": filename, "bytes": pdf.stat().st_size, "pages": len(texts),
                               "chapters": options, "uploaded": uploaded or datetime.now().timestamp()},
                              indent=1, ensure_ascii=False), encoding="utf-8")
    chapters = [o for o in options if o["selector"] != "__all__"]
    if kind == "auto":
        kind = "article" if len(texts) <= ARTICLE_MAX_PAGES or not chapters else "book"
    rows = []
    if kind == "article" or not chapters:
        rows.append({"selector": "__all__", "number": "", "title": meta["title"], "pages": [1, len(texts)], "sections": 0})
    else:
        numbered = 0
        for o in chapters:
            num, title = pdfmeta.split_number(o["title"])
            if not num:
                num = pdfmeta.printed_number(texts[o["pages"][0] - 1] if o["pages"][0] <= len(texts) else "", title)
            numbered += bool(num)
            rows.append({"selector": o["selector"], "number": num, "title": title, "pages": o["pages"], "sections": o["sections"]})
        if not numbered:  # nothing printed anywhere: number them in order
            for i, r in enumerate(rows, 1):
                r["number"] = str(i)
    for r in rows:
        r["words"] = pdfmeta.words_in(texts, *r["pages"])
    return {"meta": meta, "kind": kind, "pages": len(texts), "words": sum(len(t.split()) for t in texts),
            "accent": accent, "cover": (folder / "cover.webp").exists(), "chapters": rows}


@router.post("/api/documents")
async def upload(file: UploadFile = File(...), kind: str = Form("auto"), user: User = Depends(current_user),
                 db: Session = Depends(get_db)) -> dict:
    if kind not in ("auto", "book", "article"):
        raise HTTPException(422, "kind must be auto, book or article")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, f"file too large ({MAX_UPLOAD // 2**20} MB max)")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "only PDF files are supported for now")
    sha = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(Document).where(Document.owner_id == user.id, Document.sha256 == sha))
    if existing:
        return {**document_json(existing), "existing": True}
    did = new_id()
    folder = config.UPLOADS / did
    folder.mkdir(parents=True)
    pdf = folder / "file.pdf"
    pdf.write_bytes(data)
    name = Path(file.filename or "document.pdf").name[:250]
    try:
        info = await run_in_threadpool(analyse, pdf, folder, name, kind)
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(400, f"could not read this PDF: {type(e).__name__}") from e
    m = info["meta"]
    doc = Document(id=did, owner_id=user.id, kind=info["kind"], title=m["title"], subtitle=m["subtitle"], authors=m["authors"],
                   edition=m["edition"], accent=info["accent"] or "#ff9159", filename=name, sha256=sha, pages=info["pages"],
                   bytes=len(data), words=info["words"], has_cover=info["cover"])
    doc.search_text = search_text(doc)
    doc.chapters = [Chapter(position=i, number=r["number"], title=r["title"][:500], selector=r["selector"], page_start=r["pages"][0],
                            page_end=r["pages"][1], section_count=r["sections"], words=r["words"])
                    for i, r in enumerate(info["chapters"], 1)]
    db.add(doc)
    db.commit()
    return {**document_json(doc), "existing": False}


def search_text(d: Document) -> str:
    return " ".join([d.title, d.subtitle, " ".join(d.authors or []), d.edition, re.sub(r"\.pdf$", "", d.filename or "", flags=re.I)])


# ---------------------------------------------------------------- library

@router.get("/api/documents")
def list_documents(kind: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    q = select(Document).where(Document.owner_id == user.id)
    if kind in ("book", "article"):
        q = q.where(Document.kind == kind)
    docs = db.scalars(q.order_by(Document.updated_at.desc())).unique().all()
    prog = _progress_map(db, user, [c.id for d in docs for c in d.chapters])
    return [document_json(d, progress=prog) for d in docs]


@router.get("/api/documents/{doc_id}")
def get_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    d = owned_doc(db, doc_id, user)
    ids = [c.id for c in d.chapters]
    prog, jobs = _progress_map(db, user, ids), _active_jobs(db, ids)
    return {**document_json(d, progress=prog), "chapters": [chapter_json(db, c, prog.get(c.id), jobs.get(c.id)) for c in d.chapters]}


@router.patch("/api/documents/{doc_id}")
def edit_document(doc_id: str, body: dict = Body(...), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    d = owned_doc(db, doc_id, user)
    if "title" in body and str(body["title"]).strip():
        d.title = str(body["title"]).strip()[:300]
    if "subtitle" in body:
        d.subtitle = str(body["subtitle"] or "").strip()[:300]
    if "authors" in body and isinstance(body["authors"], list):
        d.authors = [str(a).strip()[:120] for a in body["authors"] if str(a).strip()][:8]
    d.search_text = search_text(d)
    d.updated_at = datetime.now(timezone.utc)
    db.commit()
    return document_json(d)


@router.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    d = owned_doc(db, doc_id, user)
    if any(c.status == "running" for c in d.chapters):
        raise HTTPException(409, "a chapter of this document is being generated; wait for it to finish")
    job_ids = list(db.scalars(select(Job.id).where(Job.document_id == d.id)))
    source = d.source
    db.delete(d)
    db.commit()
    if source == "upload":  # hand-built pages live in the repo
        shutil.rmtree(config.UPLOADS / doc_id, ignore_errors=True)
        for jid in job_ids:
            shutil.rmtree(config.JOBS / jid, ignore_errors=True)
    return {"ok": True}


@router.get("/api/documents/{doc_id}/cover")
def cover(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    d = owned_doc(db, doc_id, user)
    p = config.UPLOADS / d.id / "cover.webp"
    if not d.has_cover or not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/webp", headers={"Cache-Control": "private, max-age=604800, immutable"})


@router.get("/api/home")
def home(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    recent = db.execute(select(ReadingProgress, Chapter, Document).join(Chapter, Chapter.id == ReadingProgress.chapter_id)
                        .join(Document, Document.id == Chapter.document_id)
                        .where(ReadingProgress.user_id == user.id, Document.owner_id == user.id, Chapter.status == "ready")
                        .order_by(ReadingProgress.updated_at.desc()).limit(8)).all()
    active = db.scalars(select(Job).where(Job.owner_id == user.id, Job.status.in_(ACTIVE)).order_by(Job.queued_at)).all()
    docs = db.scalars(select(Document).where(Document.owner_id == user.id).order_by(Document.updated_at.desc()).limit(8)).unique().all()
    return {
        "continue": [{"chapter": chapter_json(db, c, p), "document": document_json(d, chapters=[])} for p, c, d in recent],
        "active": [{"job": job_brief(db, j), "chapter": {"id": j.chapter.id, "number": j.chapter.number, "title": j.chapter.title},
                    "document": {"id": j.document.id, "title": j.document.title, "kind": j.document.kind}} for j in active],
        "recent": [document_json(d) for d in docs],
        "quota": quota_json(db, user),
    }


def quota_json(db: Session, user: User) -> dict:
    used = words_used(db, user.id)
    return {"used": used, "limit": None if user.role == "admin" else config.WORD_QUOTA, "days": config.QUOTA_DAYS,
            "remaining": None if user.role == "admin" else max(0, config.WORD_QUOTA - used)}


@router.get("/api/me/quota")
def my_quota(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return quota_json(db, user)


# ---------------------------------------------------------------- chapters

@router.get("/api/chapters/{chapter_id}")
def get_chapter(chapter_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    c = owned_chapter(db, chapter_id, user)
    d = c.document
    ready = [x for x in d.chapters if x.status == "ready"]
    i = next((k for k, x in enumerate(ready) if x.id == c.id), -1)
    nav = lambda x: x and {"id": x.id, "number": x.number, "title": x.title}  # noqa: E731
    prog = _progress_map(db, user, [c.id]).get(c.id)
    return {"chapter": chapter_json(db, c, prog, _active_jobs(db, [c.id]).get(c.id), full=True),
            "document": document_json(d, chapters=[]),
            "prev": nav(ready[i - 1]) if i > 0 else None, "next": nav(ready[i + 1]) if 0 <= i < len(ready) - 1 else None,
            "base": f"/read/{c.id}/"}


@router.post("/api/chapters/{chapter_id}/questions")
def questions(chapter_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """3-4 questions whose answers tailor the page to this reader (one cached model call)."""
    c = owned_chapter(db, chapter_id, user)
    if c.document.source != "upload" or c.selector == "handbuilt":
        raise HTTPException(400, "this chapter cannot be generated")
    try:
        return harness_jobs.probe_questions(c.document_id, c.selector)
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:  # noqa: BLE001  (no key, provider down): generation still works without questions
        raise HTTPException(502, "could not prepare questions right now") from e


def build_spec(job_id: str, c: Chapter, user: User, reader: dict | str | None, options: dict) -> dict:
    """What the harness gets (job.json). Readers get the defaults; admins may pick models, budget and a dry run."""
    cfg = load_config()
    nodes = {k: dict(v) for k, v in cfg["nodes"].items()}
    budget = config.USER_BUDGET_USD
    max_fix = cfg["run"]["max_fix_rounds"]
    if user.role == "admin":
        if options.get("write_model"):
            nodes["write"]["model"] = nodes["fix"]["model"] = str(options["write_model"])
        if options.get("plan_model"):
            nodes["plan"]["model"] = str(options["plan_model"])
        if options.get("write_thinking") is not None:
            nodes["write"]["thinking"] = bool(options["write_thinking"])
        if options.get("dry_run"):
            for n in nodes.values():
                n["provider"] = "replay"
        budget = float(options.get("budget") or cfg["run"]["budget_usd"])
        if options.get("max_fix") is not None:
            max_fix = int(options["max_fix"])
    d = c.document
    return {"id": job_id, "upload": d.id, "file": d.filename, "chapter": c.selector,
            "chapter_title": f"{c.number} {c.title}".strip() if d.kind == "book" else c.title,
            "chapter_id": c.number or str(c.position), "chapter_position": None, "nodes": nodes, "budget": budget,
            "max_fix": max_fix, "reader": harness_jobs.reader_text(reader), "started": datetime.now().timestamp(),
            "dry_run": bool(user.role == "admin" and options.get("dry_run"))}


@router.post("/api/chapters/{chapter_id}/generate")
def generate(chapter_id: int, body: dict = Body(default={}), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    c = owned_chapter(db, chapter_id, user)
    if c.document.source != "upload" or c.selector == "handbuilt":
        raise HTTPException(400, "this chapter cannot be generated")
    if _active_jobs(db, [c.id]):
        raise HTTPException(409, "this chapter is already being generated")
    if user.role != "admin":
        used = words_used(db, user.id)
        if used + c.words > config.WORD_QUOTA:
            left = max(0, config.WORD_QUOTA - used)
            raise HTTPException(429, f"This chapter is about {c.words:,} words and you have {left:,} of your "
                                     f"{config.WORD_QUOTA:,}-word allowance left for the last {config.QUOTA_DAYS} days.")
    jid = new_id()
    job = Job(id=jid, owner_id=user.id, document_id=c.document_id, chapter_id=c.id, words=c.words,
              spec=build_spec(jid, c, user, body.get("reader"), body.get("options") or {}))
    enqueue(db, job)
    return job_brief(db, job)


@router.put("/api/chapters/{chapter_id}/progress")
def save_progress(chapter_id: int, body: dict = Body(...), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    c = owned_chapter(db, chapter_id, user)
    n = max(1, min(len(c.parts or []) or 1, int(body.get("part") or 1)))
    offset = max(0.0, min(1.0, float(body.get("offset") or 0)))
    words = [p.get("words", 1) or 1 for p in (c.parts or [{"words": 1}])]
    percent = (sum(words[: n - 1]) + offset * words[n - 1]) / max(1, sum(words))
    p = db.get(ReadingProgress, (user.id, c.id))
    if not p:
        p = ReadingProgress(user_id=user.id, chapter_id=c.id)
        db.add(p)
    p.part, p.anchor, p.offset = n, str(body.get("anchor") or "")[:120], offset
    p.percent = percent
    p.furthest = max(p.furthest or 0.0, percent)
    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    return progress_json(p)


@router.delete("/api/chapters/{chapter_id}/progress")
def reset_progress(chapter_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    c = owned_chapter(db, chapter_id, user)
    p = db.get(ReadingProgress, (user.id, c.id))
    if p:
        db.delete(p)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- the pages

def _safe_file(base: Path, rel: str) -> Path:
    target = (base / rel).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(404)
    if target.is_dir():
        target = target / "index.html"
    if not target.is_file():
        raise HTTPException(404)
    return target


@router.get("/read/{chapter_id}/{rel:path}")
def read_page(chapter_id: int, rel: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    from .indexing import page_path

    c = owned_chapter(db, chapter_id, user)
    base = page_path(c) if c.status == "ready" else None
    if not base or not base.is_dir():
        raise HTTPException(404, "chapter not available")
    f = _safe_file(base, rel or "index.html")
    if f.suffix == ".html":
        html = f.read_text(encoding="utf-8", errors="replace")
        tag = '<script src="/reader-bridge.js" defer></script>'
        html = html.replace("</body>", tag + "</body>", 1) if "</body>" in html else html + tag
        return Response(html, media_type="text/html; charset=utf-8", headers={"Cache-Control": "private, no-cache"})
    immutable = "/assets/" in f.as_posix() and re.search(r"\.[0-9a-f]{10}\.", f.name)
    return FileResponse(f, headers={"Cache-Control": "private, max-age=31536000, immutable" if immutable else "private, no-cache"})


@router.get("/reader-bridge.js")
def bridge() -> FileResponse:
    return FileResponse(BRIDGE, media_type="text/javascript", headers={"Cache-Control": "no-cache"})
