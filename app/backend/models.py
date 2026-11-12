"""The schema. Book text never goes here beyond what search needs; files stay on disk under DATA.

  users ─< sessions
  users ─< documents ─< chapters ─< content_sections     (a document is a book or an article)
  users ─< jobs >─ chapters, jobs ─< job_events            (jobs are the queue)
  users ─< reading_progress >─ chapters
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (BigInteger, Computed, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text,
                        UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = ("user", "admin")
DOC_KINDS = ("book", "article")
CHAPTER_STATES = ("none", "queued", "running", "ready", "failed")
JOB_STATES = ("queued", "running", "done", "failed", "cancelled")


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    created_at: Mapped[datetime] = _now()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ux_users_email", func.lower(email), unique=True),)


class AuthSession(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 of the cookie value
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = _now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    user: Mapped[User] = relationship(lazy="joined")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # same id as its folder under uploads/
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="book")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    authors: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    edition: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    blurb: Mapped[str] = mapped_column(Text, nullable=False, default="")
    accent: Mapped[str] = mapped_column(String(16), nullable=False, default="#ff9159")
    filename: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sha256: Mapped[str | None] = mapped_column(String(64))
    pages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    words: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_cover: Mapped[bool] = mapped_column(default=False, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")  # upload | handbuilt
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()
    search_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # english (stemmed) for whole words, simple (as written) so a half-typed word still matches by prefix
    search_tsv = mapped_column(TSVECTOR, Computed("to_tsvector('english', search_text) || to_tsvector('simple', search_text)",
                                                  persisted=True))
    chapters: Mapped[list[Chapter]] = relationship(back_populates="document", order_by="Chapter.position",
                                                   cascade="all, delete-orphan")
    __table_args__ = (
        UniqueConstraint("owner_id", "sha256", name="ux_documents_owner_sha"),
        Index("ix_documents_owner_kind", "owner_id", "kind", "updated_at"),
        Index("ix_documents_tsv", "search_tsv", postgresql_using="gin"),
        Index("ix_documents_title_trgm", "title", postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"}),
    )


class Chapter(Base):
    __tablename__ = "chapters"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    number: Mapped[str] = mapped_column(String(16), nullable=False, default="")   # as printed: "7", "12", "" for an article
    title: Mapped[str] = mapped_column(Text, nullable=False)                       # without "Chapter 7." in front
    selector: Mapped[str] = mapped_column(String(32), nullable=False, default="__all__")  # what the pipeline is given
    page_start: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    page_end: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    section_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    words: Mapped[int] = mapped_column(Integer, nullable=False, default=0)       # source words, for quota and reading time
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="none", server_default="none")
    current_job_id: Mapped[str | None] = mapped_column(String(40))
    page_dir: Mapped[str | None] = mapped_column(Text)            # the built page folder (dist/)
    parts: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # [{n, file, sections: [{id, num, title}], words}]
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    document: Mapped[Document] = relationship(back_populates="chapters")
    search_tsv = mapped_column(TSVECTOR, Computed("to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '')) || "
                                                  "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))",
                                                  persisted=True))
    __table_args__ = (
        UniqueConstraint("document_id", "position", name="ux_chapters_doc_pos"),
        Index("ix_chapters_status", "document_id", "status"),
        Index("ix_chapters_tsv", "search_tsv", postgresql_using="gin"),
        Index("ix_chapters_title_trgm", "title", postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"}),
    )


class ContentSection(Base):
    """The plain text of each section of a ready chapter, for full-text search into the reading itself."""
    __tablename__ = "content_sections"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    part: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    anchor: Mapped[str] = mapped_column(String(120), nullable=False)
    number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tsv = mapped_column(TSVECTOR, Computed("setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
                                           "setweight(to_tsvector('english', coalesce(body, '')), 'B') || "
                                           "setweight(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '')), 'D')",
                                           persisted=True))
    __table_args__ = (Index("ix_content_sections_tsv", "tsv", postgresql_using="gin"),)


class Job(Base):
    """One pipeline run. Also the queue: workers claim the oldest queued row with FOR UPDATE SKIP LOCKED."""
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # same id as its folder under jobs/
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", server_default="queued")
    stage: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # 0..1
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")         # "4 of 12 sections written"
    words: Mapped[int] = mapped_column(Integer, nullable=False, default=0)        # charged against the quota
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)       # what the harness gets (job.json)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 5), nullable=False, default=0)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    worker: Mapped[str | None] = mapped_column(String(80))
    error: Mapped[str | None] = mapped_column(Text)
    queued_at: Mapped[datetime] = _now()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    chapter: Mapped[Chapter] = relationship(lazy="joined")
    document: Mapped[Document] = relationship(lazy="joined")
    __table_args__ = (
        Index("ix_jobs_queue", "queued_at", postgresql_where=text("status = 'queued'")),
        Index("ix_jobs_running", "heartbeat_at", postgresql_where=text("status = 'running'")),
        Index("ix_jobs_owner_time", "owner_id", "queued_at"),
    )


class JobEvent(Base):
    __tablename__ = "job_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    ts: Mapped[datetime] = _now()
    stage: Mapped[str] = mapped_column(String(24), nullable=False)
    msg: Mapped[str] = mapped_column(Text, nullable=False, default="")
    chunk: Mapped[str | None] = mapped_column(String(16))
    level: Mapped[str] = mapped_column(String(8), nullable=False, default="info")
    __table_args__ = (Index("ix_job_events_job", "job_id", "id"),)


class ReadingProgress(Base):
    __tablename__ = "reading_progress"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), primary_key=True)
    part: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    anchor: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    offset: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)    # scroll fraction within the part
    percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)   # of the whole chapter, 0..1
    furthest: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # the most ever read, 0..1
    updated_at: Mapped[datetime] = _now()
    __table_args__ = (Index("ix_progress_recent", "user_id", "updated_at"),)
