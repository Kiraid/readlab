"""The job queue, in Postgres. A job row is queued, then a worker claims it (FOR UPDATE SKIP LOCKED, so two workers
never take the same one), keeps a heartbeat while it runs, and marks it done or failed. A running job whose
heartbeat stops (worker killed, machine restarted) is put back in the queue, up to MAX_ATTEMPTS.

Channels: `jobs_queued` wakes workers; `job_events` (payload: job id) wakes the live progress streams.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from . import config
from .db import notify
from .models import Chapter, Job

# What a reader sees for each stage of the graph. Admins see the raw events as well.
LABELS = {
    "queued": "Waiting in the queue",
    "starting": "Starting",
    "ingest": "Ingesting",
    "digest": "Reading closely",
    "plan": "Planning",
    "write": "Writing",
    "judge": "Judging",
    "correct": "Polishing",
    "build": "Building pages",
    "done": "Ready",
    "error": "Failed",
    "failed": "Failed",
    "cancelled": "Cancelled",
}

# Share of the bar each stage ends at; writing and judging fill the long middle stretch chunk by chunk.
SPANS = {"queued": (0, 0), "starting": (0, .02), "ingest": (.02, .08), "digest": (.08, .22), "plan": (.22, .28),
         "write": (.28, .94), "build": (.94, .99), "done": (1, 1)}


def progress_of(stage: str, total: int, digested: int, written: int, judged: int) -> float:
    lo, hi = SPANS.get(stage, (0, 0))
    if stage == "digest" and total:
        return lo + (hi - lo) * digested / total
    if stage == "write" and total:
        return lo + (hi - lo) * (0.6 * written + 0.4 * judged) / total
    return lo if stage not in ("done",) else 1.0


def detail_of(stage: str, shown: str, total: int, digested: int, written: int, judged: int) -> str:
    if stage == "digest" and total:
        return f"{digested} of {total} passages read"
    if stage == "write" and total:
        if shown in ("judge", "correct"):
            return f"{judged} of {total} sections reviewed"
        return f"{written} of {total} sections written"
    return ""


def label_of(stage: str) -> str:
    return LABELS.get(stage, stage.capitalize())


class Tracker:
    """Folds a job's events into counts the progress bar needs. One per running job, in the worker."""

    def __init__(self) -> None:
        self.total = 0
        self.digested: set[str] = set()
        self.written: set[str] = set()
        self.judged: set[str] = set()
        self.stage = "starting"

    def feed(self, kind: str, row: dict) -> None:
        if kind == "status":
            self.total = len(row.get("chunks") or []) or self.total
            self.stage = row.get("stage") or self.stage
            return
        st, chunk = row.get("stage"), row.get("chunk")
        if not chunk:
            return
        if st == "digest":
            self.digested.add(chunk)
        elif st == "write" and row.get("msg") != "writing":
            self.written.add(chunk)
        elif st == "judge":
            self.judged.add(chunk)

    def shown(self) -> str:
        """The stage a reader sees. Sections are written and judged in parallel; the label moves on once every
        section has passed the step, so it never flips back and forth."""
        stage = self.stage if self.stage not in ("done", "error") else "build"
        if stage == "write" and self.total:
            if len(self.written) >= self.total:
                return "judge" if len(self.judged) < self.total else "correct"
        return stage

    def snapshot(self) -> tuple[str, float, str]:
        """(shown stage, progress 0..1, detail line)."""
        stage = self.stage if self.stage not in ("done", "error") else "build"
        shown = self.shown()
        args = (self.total, len(self.digested), len(self.written), len(self.judged))
        return shown, progress_of(stage, *args), detail_of(stage, shown, *args)


def words_used(db: Session, owner_id, days: int = config.QUOTA_DAYS) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return int(db.scalar(select(func.coalesce(func.sum(Job.words), 0)).where(
        Job.owner_id == owner_id, Job.queued_at >= since, Job.status.in_(("queued", "running", "done")))) or 0)


def new_id() -> str:
    import time
    import uuid

    return time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]


def enqueue(db: Session, job: Job) -> Job:
    db.add(job)
    ch = db.get(Chapter, job.chapter_id)
    if ch and ch.status != "ready":
        ch.status = "queued"
    db.flush()
    notify(db, "jobs_queued", job.id)
    notify(db, "job_events", job.id)
    db.commit()
    return job


def claim(db: Session, worker: str) -> Job | None:
    jid = db.scalar(text(
        "UPDATE jobs SET status = 'running', stage = 'starting', worker = :w, started_at = now(), heartbeat_at = now(), "
        "attempts = attempts + 1 WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY queued_at "
        "FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id"), {"w": worker})
    db.commit()
    return db.get(Job, jid) if jid else None


def heartbeat(db: Session, ids: list[str]) -> None:
    if ids:
        db.execute(update(Job).where(Job.id.in_(ids), Job.status == "running").values(heartbeat_at=func.now()))
        db.commit()


def requeue_stale(db: Session) -> list[str]:
    """Running jobs whose worker went quiet: back in the queue, or failed once they have used their attempts."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=config.STALE_AFTER_S)
    stale = db.scalars(select(Job).where(Job.status == "running", Job.heartbeat_at < cutoff).with_for_update(skip_locked=True, of=Job)).all()
    for j in stale:
        if j.attempts >= config.MAX_ATTEMPTS:
            j.status, j.stage, j.error, j.finished_at = "failed", "failed", "the worker stopped responding", func.now()
            if j.chapter and j.chapter.status != "ready":
                j.chapter.status = "failed"
        else:
            j.status, j.stage, j.worker = "queued", "queued", None
    if stale:
        db.flush()
        for j in stale:
            notify(db, "job_events", j.id)
        notify(db, "jobs_queued", "requeue")
    db.commit()
    return [j.id for j in stale]


def queue_position(db: Session, job: Job) -> int | None:
    if job.status != "queued":
        return None
    return int(db.scalar(select(func.count()).select_from(Job).where(Job.status == "queued", Job.queued_at < job.queued_at)) or 0) + 1
