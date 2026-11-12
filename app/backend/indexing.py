"""Make a built page the chapter's current version: its parts (for paging), counts, summary, and the plain text of
every section in content_sections (for search)."""
from __future__ import annotations

import html as htmllib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .config import ROOT
from .library import COUNTERS
from .models import Chapter, ContentSection

SECTION = re.compile(r'<section class="(major|sub)" id="([^"]+)"[^>]*>\s*<h[23][^>]*>(?:<span class="num">([^<]*)</span>)?\s*(.*?)</h[23]>', re.S)


def rel(p: Path) -> str:
    p = p.resolve()
    try:
        return p.relative_to(ROOT).as_posix()
    except ValueError:
        return p.as_posix()


def page_path(ch: Chapter) -> Path | None:
    return (ROOT / ch.page_dir).resolve() if ch.page_dir else None


def text_of(fragment: str) -> str:
    t = re.sub(r"<(script|style|svg)[\s\S]*?</\1>", " ", fragment, flags=re.I)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


def split_existing(page_dir: Path) -> bool:
    """Runs from before the paged build: build the parts from the page's sources (no model, a few seconds)."""
    src = page_dir.parent
    if (page_dir / "manifest.json").exists() or not (src / "chapter.yaml").exists():
        return (page_dir / "manifest.json").exists()
    subprocess.run(["node", str(ROOT / "tools" / "build.mjs"), str(src), "--out", str(page_dir), "--allow-errors", "--split"],
                   capture_output=True, text=True, timeout=180, cwd=ROOT)
    return (page_dir / "manifest.json").exists()


def _stats(html: str) -> dict:
    return {k: len(rx.findall(html)) for k, rx in COUNTERS.items()}


def publish_run(db: Session, ch: Chapter, job_dir: Path, job_id: str) -> None:
    dist = job_dir / "page" / "dist"
    if not (dist / "index.html").exists():
        raise FileNotFoundError(f"{dist}/index.html")
    if not split_existing(dist):
        raise RuntimeError("the paged build is missing")
    manifest = json.loads((dist / "manifest.json").read_text(encoding="utf-8"))
    search = json.loads((dist / "search.json").read_text(encoding="utf-8"))
    plan = json.loads((job_dir / "plan.json").read_text(encoding="utf-8")) if (job_dir / "plan.json").exists() else {}
    html = "\n".join((dist / p["file"]).read_text(encoding="utf-8") for p in manifest["parts"])
    ch.parts = manifest["parts"]
    ch.stats = {**_stats(html), "words": sum(p.get("words", 0) for p in manifest["parts"])}
    ch.summary = str(plan.get("chapter_summary") or ch.summary or "")[:2000]
    _set_ready(db, ch, dist, job_id, [(s["part"], s["id"], s["num"], s["title"], s["text"]) for s in search])


def publish_handbuilt(db: Session, ch: Chapter, site: Path) -> None:
    """A hand-built site (index.html + sections/*.html): one part, sections read from the fragments."""
    frags = sorted((site / "sections").glob("*.html")) or [site / "index.html"]
    rows, secs, html = [], [], ""
    for f in frags:
        body = f.read_text(encoding="utf-8", errors="replace")
        html += body
        found = list(SECTION.finditer(body))
        for i, m in enumerate(found):
            end = found[i + 1].start() if i + 1 < len(found) else len(body)
            title = text_of(m.group(4))
            secs.append({"id": m.group(2), "num": (m.group(3) or "").strip(), "title": title, "level": m.group(1)})
            rows.append((1, m.group(2), (m.group(3) or "").strip(), title, text_of(body[m.end():end])))
    words = sum(len(r[4].split()) for r in rows)
    ch.parts = [{"n": 1, "file": "index.html", "words": words, "sections": secs}]
    ch.stats = {**_stats(html), "words": words}
    _set_ready(db, ch, site, None, rows)


def _set_ready(db: Session, ch: Chapter, page_dir: Path, job_id: str | None, rows: list[tuple]) -> None:
    ch.page_dir = rel(page_dir)
    ch.current_job_id = job_id
    ch.status = "ready"
    ch.ready_at = datetime.now(timezone.utc)
    db.flush()
    db.execute(delete(ContentSection).where(ContentSection.chapter_id == ch.id))
    db.add_all(ContentSection(chapter_id=ch.id, part=part, anchor=anchor[:120], number=num[:32], title=title, body=body)
               for part, anchor, num, title, body in rows)
    db.flush()
