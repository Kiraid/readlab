"""Admin commands.

  python -m app.backend.cli migrate                         apply database migrations
  python -m app.backend.cli create-admin [--email E]        create or promote an admin (password from
                                                            READLAB_ADMIN_PASSWORD, else asked for)
  python -m app.backend.cli import-legacy --email E         move the files-only library (sources/uploads, sources/jobs,
                                                            app/library.yaml) into the database, owned by E
  python -m app.backend.cli reindex                         rebuild every ready chapter's parts and search text
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import sys
from datetime import datetime, timezone

from sqlalchemy import select

from . import config


def migrate() -> None:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config(str(config.ROOT / "alembic.ini")), "head")
    print("database is up to date")


def create_admin(email: str, password: str | None) -> None:
    from .auth import find_user, hash_password
    from .db import session
    from .models import User

    with session() as db:
        user = find_user(db, email)
        if user:
            user.role = "admin"
            if password:
                user.password_hash = hash_password(password)
            print(f"{email}: now an admin" + (", password set" if password else ""))
        else:
            if not password:
                password = getpass.getpass(f"password for {email}: ")
            db.add(User(email=email, name=email.split("@")[0], password_hash=hash_password(password), role="admin"))
            print(f"{email}: admin created")
        db.commit()


def _ts(t: float | None) -> datetime:
    return datetime.fromtimestamp(t or 0, timezone.utc)


def import_legacy(email: str) -> None:
    """Idempotent: documents and jobs already in the database are skipped."""
    from pipeline.llm.core import read_ledger

    from .auth import find_user
    from .db import session
    from .documents import analyse, search_text
    from .indexing import publish_handbuilt, publish_run
    from .library import load_library
    from .models import Chapter, Document, Job, JobEvent

    with session() as db:
        owner = find_user(db, email)
        if not owner:
            sys.exit(f"no user {email}: run create-admin first")
        by_upload: dict[str, Document] = {}

        # 1. uploads -> documents (the same PDF uploaded twice becomes one document)
        metas = sorted((json.loads(p.read_text(encoding="utf-8")) for p in config.UPLOADS.glob("*/meta.json")), key=lambda m: m["uploaded"])
        for m in metas:
            folder = config.UPLOADS / m["id"]
            pdf = folder / "file.pdf"
            if not pdf.exists():
                continue
            sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
            doc = db.scalar(select(Document).where(Document.owner_id == owner.id, Document.sha256 == sha))
            if not doc:
                info = analyse(pdf, folder, m["name"], "book")
                mt = info["meta"]
                doc = Document(id=m["id"], owner_id=owner.id, kind=info["kind"], title=mt["title"], subtitle=mt["subtitle"],
                               authors=mt["authors"], edition=mt["edition"], accent=info["accent"] or "#ff9159", filename=m["name"],
                               sha256=sha, pages=info["pages"], bytes=pdf.stat().st_size, words=info["words"], has_cover=info["cover"],
                               created_at=_ts(m["uploaded"]), updated_at=_ts(m["uploaded"]))
                doc.search_text = search_text(doc)
                doc.chapters = [Chapter(position=i, number=r["number"], title=r["title"][:500], selector=r["selector"],
                                        page_start=r["pages"][0], page_end=r["pages"][1], section_count=r["sections"], words=r["words"])
                                for i, r in enumerate(info["chapters"], 1)]
                db.add(doc)
                db.flush()
                print(f"document  {doc.title}  ({len(doc.chapters)} chapters)")
            by_upload[m["id"]] = doc
        db.commit()

        # 2. jobs -> job rows; the newest finished run of a chapter becomes what it shows
        specs = sorted((json.loads(p.read_text(encoding="utf-8")) for p in config.JOBS.glob("*/job.json")), key=lambda s: s.get("started", 0))
        for spec in specs:
            jid = spec["id"]
            if db.get(Job, jid):
                continue
            doc = by_upload.get(spec.get("upload"))
            ch = doc and next((c for c in doc.chapters if c.selector == spec.get("chapter")), None)
            if not ch:
                print(f"skip job  {jid}: its chapter is not in the library")
                continue
            jdir = config.JOBS / jid
            st = json.loads((jdir / "status.json").read_text(encoding="utf-8")) if (jdir / "status.json").exists() else {}
            built = (jdir / "page" / "dist" / "index.html").exists()
            ok = st.get("stage") == "done" and built
            cost = round(sum(r.get("cost_usd", 0) for r in read_ledger(jdir / "ledger.jsonl")), 5)
            job = Job(id=jid, owner_id=owner.id, document_id=doc.id, chapter_id=ch.id, status="done" if ok else "failed",
                      stage="done" if ok else "failed", progress=1.0 if ok else 0.0, words=ch.words, spec=spec, cost_usd=cost,
                      attempts=1, error=None if ok else (st.get("error") or "no page was built"),
                      queued_at=_ts(spec.get("started")), started_at=_ts(spec.get("started")),
                      finished_at=_ts(st.get("finished") or st.get("updated") or spec.get("started")))
            db.add(job)
            db.flush()
            if (jdir / "events.jsonl").exists():
                for line in (jdir / "events.jsonl").read_text(encoding="utf-8").splitlines():
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    db.add(JobEvent(job_id=jid, ts=_ts(e.get("ts")), stage=str(e.get("stage", ""))[:24], msg=str(e.get("msg", "")),
                                    chunk=e.get("chunk"), level=e.get("level", "info")))
            if ok:
                try:
                    publish_run(db, ch, jdir, jid)
                    doc.updated_at = max(doc.updated_at, job.finished_at)
                except Exception as e:  # noqa: BLE001
                    job.status, job.stage, job.error = "failed", "failed", f"publish: {type(e).__name__}: {e}"
            db.commit()
            print(f"job       {jid}  {job.status}  {doc.title} / {ch.number} {ch.title}")

        # 3. hand-built chapters from app/library.yaml, into the matching book when there is one
        for b in load_library():
            doc = db.scalar(select(Document).where(Document.owner_id == owner.id, Document.title == b.title))
            if not doc:
                doc = Document(id=f"hb-{b.id}", owner_id=owner.id, kind="book", title=b.title, authors=b.authors, edition=b.edition,
                               blurb=b.blurb, accent=b.accent, source="handbuilt")
                doc.search_text = search_text(doc)
                db.add(doc)
                db.flush()
            for hc in b.chapters:
                if not hc.available or any(c.selector == "handbuilt" and c.number == hc.id for c in doc.chapters):
                    continue
                ch = Chapter(document_id=doc.id, position=10_000 + len(doc.chapters), number=hc.id, title=hc.title,
                             selector="handbuilt", summary=hc.summary)
                doc.chapters.append(ch)
                db.flush()
                publish_handbuilt(db, ch, hc.dir)
                ch.words = ch.stats.get("words", 0)
                print(f"chapter   {doc.title} / {hc.id} {hc.title} (hand-built)")
            _renumber(doc)
            db.commit()
    print("import finished")


def _renumber(doc) -> None:
    """Order chapters by their printed number (hand-built ones join an uploaded book in the right place)."""
    key = lambda c: (int(c.number) if c.number.isdigit() else 10_000, c.position)  # noqa: E731
    ordered = sorted(doc.chapters, key=key)
    for i, c in enumerate(ordered):  # two passes: positions are unique per document
        c.position = 100_000 + i
    from sqlalchemy.orm import object_session

    object_session(doc).flush()
    for i, c in enumerate(ordered, 1):
        c.position = i
    object_session(doc).flush()


def reindex() -> None:
    from .db import session
    from .indexing import page_path, publish_handbuilt, publish_run
    from .models import Chapter

    with session() as db:
        for ch in db.scalars(select(Chapter).where(Chapter.status == "ready")):
            if ch.current_job_id:
                dist = config.JOBS / ch.current_job_id / "page" / "dist"
                for f in ("manifest.json", "search.json"):
                    (dist / f).unlink(missing_ok=True)
                publish_run(db, ch, config.JOBS / ch.current_job_id, ch.current_job_id)
            elif page_path(ch):
                publish_handbuilt(db, ch, page_path(ch))
            db.commit()
            print(f"reindexed {ch.id} {ch.title}")


def main() -> None:
    ap = argparse.ArgumentParser(description="readlab admin commands")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    a = sub.add_parser("create-admin")
    a.add_argument("--email", default=config.ADMIN_EMAIL)
    i = sub.add_parser("import-legacy")
    i.add_argument("--email", default=config.ADMIN_EMAIL)
    sub.add_parser("reindex")
    args = ap.parse_args()
    if args.cmd == "migrate":
        migrate()
    elif args.cmd == "create-admin":
        if not args.email:
            sys.exit("--email (or READLAB_ADMIN_EMAIL) is required")
        create_admin(args.email, config.ADMIN_PASSWORD or None)
    elif args.cmd == "import-legacy":
        if not args.email:
            sys.exit("--email (or READLAB_ADMIN_EMAIL) is required")
        import_legacy(args.email)
    elif args.cmd == "reindex":
        reindex()


if __name__ == "__main__":
    main()
