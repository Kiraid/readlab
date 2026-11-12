"""The queue worker: claims queued jobs and runs the chapter graph on them.

  python -m app.backend.worker                  run forever (docker compose `worker` service)
  python -m app.backend.worker --drain          work through the queue, exit when it is empty
  python -m app.backend.worker --concurrency 3  jobs at once (default READLAB_WORKER_CONCURRENCY)

Each job runs in a thread. The harness's events and status changes are copied into Postgres as they happen
(job_events, jobs.stage/progress/detail) with a NOTIFY, which is what the live progress streams wait on. On
SIGTERM/Ctrl+C the worker hands its running jobs back to the queue, so another worker starts them again.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from sqlalchemy import func, update

from pipeline.harness import chapter as harness_chapter
from pipeline.harness import jobs as harness_jobs
from pipeline.llm import load_config
from pipeline.llm.core import read_ledger

from . import config
from .db import notify, session
from .indexing import publish_run
from .models import Job, JobEvent
from .queue import Tracker, claim, heartbeat, requeue_stale


def log(*a) -> None:
    print(time.strftime("%H:%M:%S"), *a, flush=True)


class Worker:
    def __init__(self, concurrency: int, drain: bool) -> None:
        self.name = f"{socket.gethostname()}:{os.getpid()}"
        self.concurrency = max(1, concurrency)
        self.drain = drain
        self.threads: dict[str, threading.Thread] = {}
        self.trackers: dict[str, Tracker] = {}
        self.stop = threading.Event()
        self.inner = load_config()["run"].get("max_concurrency", 12)

    # ------------------------------------------------------------ progress, from the harness's hook

    def hook(self, job_dir: Path, kind: str, row: dict) -> None:
        jid = job_dir.name
        tr = self.trackers.get(jid)
        if tr is None:
            return
        tr.feed(kind, row)
        shown, progress, detail = tr.snapshot()
        with session() as db:
            if kind == "event":
                db.add(JobEvent(job_id=jid, stage=str(row.get("stage", ""))[:24], msg=str(row.get("msg", "")),
                                chunk=row.get("chunk"), level=row.get("level", "info")))
            db.execute(update(Job).where(Job.id == jid, Job.status == "running").values(
                stage=shown, progress=func.greatest(Job.progress, progress), detail=detail, heartbeat_at=datetime.now(timezone.utc)))
            notify(db, "job_events", jid)
            db.commit()

    # ------------------------------------------------------------ one job

    def run_one(self, jid: str) -> None:
        jdir = config.JOBS / jid
        try:
            with session() as db:
                job = db.get(Job, jid)
                spec = {**job.spec, "id": jid}
                job.chapter.status = "running"
                db.commit()
            jdir.mkdir(parents=True, exist_ok=True)
            (jdir / "job.json").write_text(json.dumps(spec, indent=1, ensure_ascii=False), encoding="utf-8")
            if any(n.get("provider") == "replay" for n in spec["nodes"].values()):
                harness_jobs.install_dry_run()
            self.trackers[jid] = Tracker()
            log("start", jid, spec.get("chapter_title"))
            harness_jobs.run_job(jdir, spec, self.inner)
            self.finish(jid, jdir)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.fail(jid, f"{type(e).__name__}: {e}")
        finally:
            self.trackers.pop(jid, None)

    def finish(self, jid: str, jdir: Path) -> None:
        status = json.loads((jdir / "status.json").read_text(encoding="utf-8")) if (jdir / "status.json").exists() else {}
        cost = round(sum(r.get("cost_usd", 0) for r in read_ledger(jdir / "ledger.jsonl")), 5)
        if status.get("stage") != "done":
            self.fail(jid, status.get("error") or "the run stopped before the page was built", cost)
            return
        with session() as db:
            job = db.get(Job, jid)
            if job.status != "running":  # handed back or cancelled meanwhile
                return
            publish_run(db, job.chapter, jdir, jid)
            job.status, job.stage, job.progress, job.detail = "done", "done", 1.0, ""
            job.cost_usd, job.finished_at = cost, datetime.now(timezone.utc)
            job.document.updated_at = datetime.now(timezone.utc)
            notify(db, "job_events", jid)
            db.commit()
        log("done", jid, f"${cost:.4f}")

    def fail(self, jid: str, error: str, cost: float | None = None) -> None:
        with session() as db:
            job = db.get(Job, jid)
            if not job or job.status != "running":
                return
            job.status, job.stage, job.error, job.finished_at = "failed", "failed", error[:4000], datetime.now(timezone.utc)
            if cost is not None:
                job.cost_usd = cost
            if job.chapter.status != "ready":
                job.chapter.status = "failed"
            notify(db, "job_events", jid)
            db.commit()
        log("failed", jid, error[:200])

    # ------------------------------------------------------------ the loop

    def beat(self) -> None:
        n = 0
        while not self.stop.wait(20):
            try:
                with session() as db:
                    heartbeat(db, [j for j, t in self.threads.items() if t.is_alive()])
                    n += 1
                    if n % 3 == 0:
                        for jid in requeue_stale(db):
                            log("requeued stale job", jid)
            except Exception:  # noqa: BLE001
                traceback.print_exc()

    def hand_back(self) -> None:
        live = [j for j, t in self.threads.items() if t.is_alive()]
        if not live:
            return
        with session() as db:
            db.execute(update(Job).where(Job.id.in_(live), Job.status == "running", Job.worker == self.name).values(
                status="queued", stage="queued", worker=None, attempts=Job.attempts - 1))
            for jid in live:
                notify(db, "job_events", jid)
            notify(db, "jobs_queued", "handback")
            db.commit()
        log("handed back", *live)

    def run(self) -> None:
        harness_chapter.HOOKS.append(self.hook)
        with session() as db:
            for jid in requeue_stale(db):
                log("requeued stale job", jid)
        conn = psycopg.connect(config.DATABASE_URL.replace("+psycopg", ""), autocommit=True)
        conn.execute("LISTEN jobs_queued")
        threading.Thread(target=self.beat, daemon=True, name="heartbeat").start()
        log(f"worker {self.name}: up to {self.concurrency} job(s) at once" + (", draining" if self.drain else ""))
        try:
            while not self.stop.is_set():
                self.threads = {j: t for j, t in self.threads.items() if t.is_alive()}
                claimed = False
                while len(self.threads) < self.concurrency and not self.stop.is_set():
                    with session() as db:
                        job = claim(db, self.name)
                    if not job:
                        break
                    claimed = True
                    t = threading.Thread(target=self.run_one, args=(job.id,), daemon=True, name=f"job-{job.id}")
                    self.threads[job.id] = t
                    t.start()
                if self.drain and not claimed and not self.threads:
                    log("queue drained")
                    break
                for _ in conn.notifies(timeout=2 if self.threads else 30, stop_after=1):
                    pass
        finally:
            self.stop.set()
            self.hand_back()
            conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--drain", action="store_true", help="exit once the queue is empty")
    ap.add_argument("--concurrency", type=int, default=config.WORKER_CONCURRENCY)
    args = ap.parse_args()
    w = Worker(args.concurrency, args.drain)

    def on_signal(*_):
        log("stopping")
        w.stop.set()
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    w.run()


if __name__ == "__main__":
    main()
