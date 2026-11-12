"""Settings from the environment (and .env). One place, so the API, the worker and the scripts agree."""
from __future__ import annotations

import os
from pathlib import Path

from pipeline.llm.core import load_env

ROOT = Path(__file__).resolve().parents[2]
load_env()


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _database_url() -> str:
    """DATABASE_URL, else the compose database on this machine with POSTGRES_PASSWORD from .env."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    if not os.environ.get("POSTGRES_PASSWORD"):
        raise RuntimeError("set POSTGRES_PASSWORD (or DATABASE_URL) in .env; see .env.example")
    from urllib.parse import quote

    return f"postgresql+psycopg://readlab:{quote(os.environ['POSTGRES_PASSWORD'], safe='')}@127.0.0.1:5433/readlab"


DATABASE_URL = _database_url()
DATA = ROOT / "sources"  # uploads/ and jobs/; the harness uses the same folders
UPLOADS = DATA / "uploads"
JOBS = DATA / "jobs"

# Source words a user may send through the pipeline per window: about three typical technical chapters.
WORD_QUOTA = _int("READLAB_WORD_QUOTA", 30000)
QUOTA_DAYS = _int("READLAB_QUOTA_DAYS", 30)
USER_BUDGET_USD = float(os.environ.get("READLAB_USER_BUDGET_USD", "1.00"))  # per job, users cannot change it

SESSION_DAYS = _int("READLAB_SESSION_DAYS", 30)
COOKIE_SECURE = os.environ.get("READLAB_COOKIE_SECURE", "0") == "1"  # set to 1 behind https
COOKIE_NAME = "readlab_session"

WORKER_CONCURRENCY = _int("READLAB_WORKER_CONCURRENCY", 2)
STALE_AFTER_S = _int("READLAB_STALE_AFTER_S", 180)  # a running job with no heartbeat for this long is requeued
MAX_ATTEMPTS = _int("READLAB_MAX_ATTEMPTS", 2)

ADMIN_EMAIL = os.environ.get("READLAB_ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("READLAB_ADMIN_PASSWORD", "")
