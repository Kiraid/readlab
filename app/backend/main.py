"""readlab backend: the library API, the chapter pages, and the built frontend.

  ./run.sh uvicorn app.backend.main:app --host 0.0.0.0 --port 8000 [--reload]

Routes
  GET /api/books                      books with chapter summaries and counts
  GET /api/books/{book}               one book with all its chapters
  GET /read/{book}/{chapter}/...      the chapter page and its files (css, js, sections)
  GET /...                            the frontend (app/frontend/dist), with an SPA fallback

Later, chapter pages should move to their own origin: they will contain model output built from user uploads,
and must not run on the app's origin once there are logins.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

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
