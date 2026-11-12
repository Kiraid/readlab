"""readlab backend: the library API, the chapter pages, and the built frontend.

  ./run.sh uvicorn app.backend.main:app --host 0.0.0.0 --port 8000 [--reload]

Routes
  GET /api/books                      books with chapter summaries and counts
  GET /api/books/{book}               one book with all its chapters
  GET /read/{book}/{chapter}/...      the chapter page and its files (css, js, sections)
  POST /api/uploads                   upload a PDF; returns the chapters you can pick
  GET  /api/uploads[/{id}]            uploads and their chapter options
  POST /api/uploads/{id}/probe        3-4 questions about a chapter that tailor its page to the reader
  POST /api/jobs                      run the pipeline on one chapter of an upload (background thread)
  GET  /api/jobs[/{id}]               jobs; one job's live status: stage, events, cost per node, chunks
  GET  /api/jobs/{id}/sections/{c}    one written section: markdown, checks, judge, digest, brief
  GET  /api/pipeline                  the graph's nodes and edges as data (for the diagram page)
  GET /...                            the frontend (app/frontend/dist), with an SPA fallback

Later, chapter pages should move to their own origin: they will contain model output built from user uploads,
and must not run on the app's origin once there are logins.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from pipeline.harness import jobs
from pipeline.llm import load_config

from .library import ROOT, Book, chapter_stats, load_library

FRONTEND = ROOT / "app" / "frontend" / "dist"
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

app = FastAPI(title="readlab", version="0.1.0")


def _books() -> list[Book]:
    return load_library()  # re-read on every request: editing library.yaml needs no restart


def _book(book_id: str) -> Book:
    book = next((b for b in _books() if b.id == book_id), None)
    if not book:
        raise HTTPException(404, f"no book {book_id!r}")
    return book


def _chapter_json(c, book: Book) -> dict:
    return {"id": c.id, "title": c.title, "summary": c.summary, "made": c.made, "available": c.available,
            "stats": chapter_stats(c), "url": f"/read/{book.id}/{c.id}/"}


def _book_json(b: Book, full: bool) -> dict:
    chapters = [_chapter_json(c, b) for c in b.chapters]
    out = {"id": b.id, "title": b.title, "edition": b.edition, "authors": b.authors, "accent": b.accent, "blurb": b.blurb,
           "chapter_count": len(chapters), "ready_count": sum(c["available"] for c in chapters)}
    if full:
        out["chapters"] = chapters
    else:
        out["chapters"] = [{"id": c["id"], "title": c["title"], "available": c["available"]} for c in chapters]
    return out


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/books")
def list_books() -> list[dict]:
    return [_book_json(b, full=False) for b in _books()]


@app.get("/api/books/{book_id}")
def get_book(book_id: str) -> dict:
    return _book_json(_book(book_id), full=True)


MAX_UPLOAD = 80 * 1024 * 1024


@app.post("/api/uploads")
async def upload(file: UploadFile = File(...)) -> dict:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "file too large (80 MB max)")
    try:
        return jobs.save_upload(file.filename or "document.pdf", data)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/uploads")
def uploads() -> list[dict]:
    return jobs.list_uploads()


@app.get("/api/uploads/{uid}")
def get_upload(uid: str) -> dict:
    try:
        return jobs.get_upload(uid)
    except KeyError as e:
        raise HTTPException(404, "no such upload") from e


@app.post("/api/uploads/{uid}/probe")
def probe(uid: str, body: dict = Body(...)) -> dict:
    """Questions about the chosen chapter whose answers tailor the page to the reader (one model call, cached)."""
    try:
        return jobs.probe_questions(uid, body["chapter"])
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:  # noqa: BLE001  (no API key, provider down): the upload still works without questions
        raise HTTPException(502, f"could not write questions: {type(e).__name__}: {e}") from e


@app.post("/api/jobs")
def create_job(body: dict = Body(...)) -> dict:
    try:
        return jobs.start_job(body["upload_id"], body["chapter"], body.get("options") or {})
    except KeyError as e:
        raise HTTPException(404, str(e)) from e


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    return jobs.list_jobs()


@app.get("/api/jobs/{jid}")
def job(jid: str) -> dict:
    try:
        return jobs.job_status(jid)
    except KeyError as e:
        raise HTTPException(404, "no such job") from e


@app.get("/api/jobs/{jid}/sections/{cid}")
def job_section(jid: str, cid: str) -> dict:
    try:
        return jobs.section_detail(jid, cid)
    except KeyError as e:
        raise HTTPException(404, "no such section") from e


@app.get("/api/pipeline")
def pipeline() -> dict:
    cfg = load_config()
    return {"nodes": cfg["nodes"], "run": cfg["run"],
            "prices": cfg["providers"]["deepseek"]["prices"]}


def _safe_file(base: Path, rel: str) -> Path:
    target = (base / rel).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(404)
    if target.is_dir():
        target = target / "index.html"
    if not target.is_file():
        raise HTTPException(404)
    return target


@app.get("/read/{book_id}/{chapter_id}")
def read_redirect(book_id: str, chapter_id: str) -> RedirectResponse:
    return RedirectResponse(f"/read/{book_id}/{chapter_id}/")  # relative asset paths need the trailing slash


@app.get("/read/{book_id}/{chapter_id}/{rel:path}")
def read_chapter(book_id: str, chapter_id: str, rel: str) -> FileResponse:
    ch = _book(book_id).chapter(chapter_id)
    if not ch or not ch.available:
        raise HTTPException(404, "chapter not available")
    return FileResponse(_safe_file(ch.dir, rel or "index.html"), headers={"Cache-Control": "no-store"})


@app.get("/{rel:path}")
def frontend(rel: str) -> FileResponse:
    if not FRONTEND.is_dir():
        raise HTTPException(503, "frontend not built: run `npm run build` in app/frontend")
    try:
        return FileResponse(_safe_file(FRONTEND.resolve(), rel or "index.html"))
    except HTTPException:
        if rel.startswith(("api/", "read/")) or "." in Path(rel).name:
            raise
        return FileResponse(FRONTEND / "index.html")  # client-side route
