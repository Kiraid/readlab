"""The library: books and their chapters, read from app/library.yaml. No database yet.

Each chapter points at a folder on disk. The backend reports whether it is available and counts what the
page contains (sections, quizzes, terminals, diagrams, labs) by scanning its HTML, cached by modification time.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "app" / "library.yaml"

COUNTERS = {
    "sections": re.compile(r'<section class="(?:major|sub)"'),
    "quizzes": re.compile(r'class="quiz"'),
    "terminals": re.compile(r'<div class="term"'),
    "diagrams": re.compile(r'<figure class="diagram'),
    "labs": re.compile(r'class="widget'),
}


@dataclass
class Chapter:
    id: str
    title: str
    path: str
    summary: str = ""
    made: str = ""

    @property
    def dir(self) -> Path:
        return (ROOT / self.path).resolve()

    @property
    def available(self) -> bool:
        return (self.dir / "index.html").is_file()


@dataclass
class Book:
    id: str
    title: str
    edition: str = ""
    authors: list[str] = field(default_factory=list)
    accent: str = "#4cc9f0"
    blurb: str = ""
    chapters: list[Chapter] = field(default_factory=list)

    def chapter(self, cid: str) -> Chapter | None:
        return next((c for c in self.chapters if c.id == cid), None)


_stats_cache: dict[str, tuple[float, dict]] = {}


def chapter_stats(ch: Chapter) -> dict:
    """Counts of what the page contains. Hand-built sites keep sections in sections/*.html."""
    if not ch.available:
        return {}
    files = [ch.dir / "index.html", *sorted((ch.dir / "sections").glob("*.html"))]
    mtime = max(f.stat().st_mtime for f in files)
    hit = _stats_cache.get(str(ch.dir))
    if hit and hit[0] == mtime:
        return hit[1]
    html = "\n".join(f.read_text(encoding="utf-8", errors="replace") for f in files)
    stats = {k: len(rx.findall(html)) for k, rx in COUNTERS.items()}
    _stats_cache[str(ch.dir)] = (mtime, stats)
    return stats


def load_library(path: Path = LIBRARY) -> list[Book]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    books = []
    for b in data.get("books", []):
        chapters = [Chapter(id=str(c["id"]), title=c["title"], path=c["path"], summary=c.get("summary", ""), made=c.get("made", ""))
                    for c in b.get("chapters", [])]
        books.append(Book(id=b["id"], title=b["title"], edition=b.get("edition", ""), authors=b.get("authors", []),
                          accent=b.get("accent", "#4cc9f0"), blurb=b.get("blurb", ""), chapters=chapters))
    return books
