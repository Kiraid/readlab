"""readlab backend: accounts, the library API, the job queue's API, chapter pages, and the built frontend.

  ./run.sh uvicorn app.backend.main:app --host 0.0.0.0 --port 8000 [--reload]
  ./run.sh python -m app.backend.worker          (the queue worker; needed for anything to be generated)

Routes (all private to the signed-in user unless marked)
  /api/auth/{signup,signin,signout,me}            accounts (signup/signin public)
  /api/documents[/{id}[/cover]]                   books and articles: upload (POST), list, one, edit, delete
  /api/chapters/{id}[/questions|/generate|/progress]   a chapter, its reader questions, queue it, reading progress
  /api/home, /api/me/quota, /api/search?q=        continue reading + active jobs, word allowance, search
  /api/jobs[/{id}[/stream|/cancel|/retry]]        jobs, their live progress (server-sent events)
  /api/admin/...                                  admins: every job with costs, queue overview, pipeline config
  /read/{chapter}/...                             the chapter's pages (parts/NN.html), with the reader bridge
  /...                                            the frontend (app/frontend/dist), with an SPA fallback

Chapter pages are model output built from uploads and run on the app's origin; see README for moving them to
their own origin.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from . import auth, documents, jobs_api, search
from .config import ROOT

FRONTEND = ROOT / "app" / "frontend" / "dist"
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("image/webp", ".webp")

app = FastAPI(title="readlab", version="0.2.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)
for r in (auth.router, documents.router, jobs_api.router, search.router):
    app.include_router(r)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/{rel:path}")
def frontend(rel: str) -> FileResponse:
    if rel.startswith(("api/", "read/")):
        raise HTTPException(404)
    if not FRONTEND.is_dir():
        raise HTTPException(503, "frontend not built: run `npm run build` in app/frontend")
    base = FRONTEND.resolve()
    target = (base / rel).resolve()
    if rel and target.is_file() and base in target.parents:
        hashed = rel.startswith("assets/")
        return FileResponse(target, headers={"Cache-Control": "public, max-age=31536000, immutable" if hashed else "no-cache"})
    if "." in Path(rel).name:
        raise HTTPException(404)
    return FileResponse(base / "index.html", headers={"Cache-Control": "no-cache"})  # a client-side route
