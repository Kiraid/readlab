"""Jobs as readers see them (a stage, a bar, a line of detail) and as admins see them (models, cost, every event,
every section's checks). Live updates go out as server-sent events, woken by Postgres NOTIFY."""
from __future__ import annotations

import asyncio
import json
import shutil
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from pipeline.harness import jobs as harness_jobs
from pipeline.llm import load_config

from . import config
from .auth import admin_user, current_user
from .db import get_db, notify, session
from .models import Chapter, Document, Job, JobEvent, User
from .queue import label_of, queue_position, words_used

router = APIRouter(tags=["jobs"])
FINAL = ("done", "failed", "cancelled")


def job_state(db: Session, j: Job, admin: bool) -> dict:
    out = {"id": j.id, "status": j.status, "stage": j.stage, "label": label_of(j.stage), "detail": j.detail or "",
           "progress": round(j.progress, 4), "position": queue_position(db, j),
           "queued_at": j.queued_at.isoformat(), "started_at": j.started_at and j.started_at.isoformat(),
           "finished_at": j.finished_at and j.finished_at.isoformat(),
           "document": {"id": j.document.id, "title": j.document.title, "kind": j.document.kind, "cover": j.document.has_cover},
           "chapter": {"id": j.chapter.id, "number": j.chapter.number, "title": j.chapter.title, "status": j.chapter.status,
                       "ready": j.chapter.status == "ready" and j.chapter.current_job_id == j.id},
           "error": None}
    if j.status == "failed":
        out["error"] = j.error if admin else "Something went wrong while generating this. You can try again."
    if admin:
        out["admin"] = {"cost_usd": float(j.cost_usd or 0), "worker": j.worker, "attempts": j.attempts, "words": j.words,
                        "owner": j.owner_id and str(j.owner_id), "models": {k: v.get("model") for k, v in (j.spec.get("nodes") or {}).items()},
                        "budget": j.spec.get("budget"), "dry_run": j.spec.get("dry_run", False)}
    return out


def visible_job(db: Session, jid: str, user: User) -> Job:
    j = db.get(Job, jid)
    if not j or (j.owner_id != user.id and user.role != "admin"):
        raise HTTPException(404, "no such job")
    return j


@router.get("/api/jobs")
def my_jobs(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Job).where(Job.owner_id == user.id).order_by(Job.queued_at.desc()).limit(50)).all()
    return [job_state(db, j, user.role == "admin") for j in rows]


@router.get("/api/jobs/{jid}")
def get_job(jid: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    j = visible_job(db, jid, user)
    out = job_state(db, j, user.role == "admin")
    if user.role == "admin":
        try:
            out["run"] = harness_jobs.job_status(jid)  # nodes, cost per node, chunks, judge scores, page build
        except KeyError:
            out["run"] = None
        out["events"] = [event_json(e) for e in db.scalars(select(JobEvent).where(JobEvent.job_id == jid).order_by(JobEvent.id.desc()).limit(400))][::-1]
    return out


def event_json(e: JobEvent) -> dict:
    return {"id": e.id, "ts": e.ts.timestamp(), "stage": e.stage, "msg": e.msg, "chunk": e.chunk, "level": e.level}


def _snapshot(jid: str, after: int, admin: bool) -> tuple[dict, list[dict]]:
    with session() as db:
        j = db.get(Job, jid)
        state = job_state(db, j, admin)
        events = []
        if admin:
            events = [event_json(e) for e in db.scalars(select(JobEvent).where(JobEvent.job_id == jid, JobEvent.id > after)
                                                        .order_by(JobEvent.id).limit(500))]
        return state, events


def _sse(event: str, data: dict, eid: int | None = None) -> str:
    return (f"id: {eid}\n" if eid else "") + f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/api/jobs/{jid}/stream")
async def stream(jid: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    """`state` events for everyone; `log` events (the harness's own lines) for admins; `end` when the job is over."""
    visible_job(db, jid, user)
    admin = user.role == "admin"
    try:
        after = int(request.headers.get("last-event-id") or 0)
    except ValueError:
        after = 0

    async def gen():
        nonlocal after
        conn = await psycopg.AsyncConnection.connect(config.DATABASE_URL.replace("+psycopg", ""), autocommit=True)
        try:
            await conn.execute("LISTEN job_events")
            yield "retry: 3000\n\n"
            while True:
                state, events = await run_in_threadpool(_snapshot, jid, after, admin)
                for e in events:
                    after = e["id"]
                    yield _sse("log", e, e["id"])
                yield _sse("state", state)
                if state["status"] in FINAL:
                    yield _sse("end", {"status": state["status"]})
                    return
                woke = False
                async for n in conn.notifies(timeout=15):
                    if n.payload == jid:
                        woke = True
                        break
                if await request.is_disconnected():
                    return
                if not woke:
                    yield ": ping\n\n"
                await asyncio.sleep(0.25)  # bursts of events (a dozen sections at once) become one update
        finally:
            await conn.close()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.post("/api/jobs/{jid}/cancel")
def cancel(jid: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    j = visible_job(db, jid, user)
    if j.status != "queued":
        raise HTTPException(409, "only a job that has not started can be cancelled")
    j.status, j.stage, j.finished_at = "cancelled", "cancelled", datetime.now(timezone.utc)
    _reset_chapter(j.chapter)
    notify(db, "job_events", j.id)
    db.commit()
    return job_state(db, j, user.role == "admin")


@router.post("/api/jobs/{jid}/retry")
def retry(jid: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    j = visible_job(db, jid, user)
    if j.status not in ("failed", "cancelled"):
        raise HTTPException(409, "only a failed or cancelled job can be retried")
    if db.scalar(select(Job.id).where(Job.chapter_id == j.chapter_id, Job.status.in_(("queued", "running")))):
        raise HTTPException(409, "this chapter is already being generated")
    if user.role != "admin" and words_used(db, j.owner_id) + j.words > config.WORD_QUOTA:
        raise HTTPException(429, "not enough of your word allowance is left to retry this")
    db.execute(delete(JobEvent).where(JobEvent.job_id == j.id))
    shutil.rmtree(config.JOBS / j.id, ignore_errors=True)
    j.status, j.stage, j.progress, j.detail, j.error = "queued", "queued", 0.0, "", None
    j.attempts, j.worker, j.started_at, j.finished_at, j.heartbeat_at = 0, None, None, None, None
    j.queued_at = datetime.now(timezone.utc)
    if j.chapter.status != "ready":
        j.chapter.status = "queued"
    notify(db, "jobs_queued", j.id)
    notify(db, "job_events", j.id)
    db.commit()
    return job_state(db, j, user.role == "admin")


def _reset_chapter(ch: Chapter) -> None:
    if ch.status != "ready":
        ch.status = "none"


# ---------------------------------------------------------------- admin

@router.get("/api/admin/jobs")
def all_jobs(status: str | None = None, limit: int = 100, _: User = Depends(admin_user), db: Session = Depends(get_db)) -> list[dict]:
    q = select(Job, User.email).join(User, User.id == Job.owner_id)
    if status:
        q = q.where(Job.status == status)
    rows = db.execute(q.order_by(Job.queued_at.desc()).limit(max(1, min(limit, 500)))).all()
    return [{**job_state(db, j, True), "owner_email": email} for j, email in rows]


@router.get("/api/admin/overview")
def overview(_: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    by_status = dict(db.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    return {
        "queue": {s: by_status.get(s, 0) for s in ("queued", "running", "done", "failed", "cancelled")},
        "workers": sorted(w for w in db.scalars(select(Job.worker).where(Job.status == "running").distinct()) if w),
        "users": db.scalar(select(func.count()).select_from(User)),
        "documents": db.scalar(select(func.count()).select_from(Document)),
        "cost_30d": float(db.scalar(select(func.coalesce(func.sum(Job.cost_usd), 0)).where(Job.queued_at >= since)) or 0),
        "words_30d": int(db.scalar(select(func.coalesce(func.sum(Job.words), 0)).where(Job.queued_at >= since, Job.status == "done")) or 0),
        "quota": {"words": config.WORD_QUOTA, "days": config.QUOTA_DAYS, "user_budget_usd": config.USER_BUDGET_USD},
    }


@router.get("/api/admin/jobs/{jid}/sections/{cid}")
def section(jid: str, cid: str, _: User = Depends(admin_user)) -> dict:
    try:
        return harness_jobs.section_detail(jid, cid)
    except (KeyError, FileNotFoundError) as e:
        raise HTTPException(404, "no such section") from e


@router.get("/api/admin/pipeline")
def pipeline(_: User = Depends(admin_user)) -> dict:
    cfg = load_config()
    return {"nodes": cfg["nodes"], "run": cfg["run"], "prices": cfg["providers"]["deepseek"]["prices"]}
