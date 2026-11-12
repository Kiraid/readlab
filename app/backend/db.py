"""Engine, sessions and the declarative base."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import config

engine = create_engine(config.DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=10)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    with SessionLocal() as db:
        yield db


@contextmanager
def session() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def notify(db: Session, channel: str, payload: str) -> None:
    from sqlalchemy import text

    db.execute(text("SELECT pg_notify(:c, :p)"), {"c": channel, "p": payload})
