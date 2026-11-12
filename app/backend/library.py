"""The library: books and their chapters, read from app/library.yaml plus every pipeline run that built a page
(sources/jobs/*/page/dist). No database yet.

Each chapter points at a folder on disk. The backend reports whether it is available and counts what the
page contains (sections, quizzes, terminals, diagrams, labs) by scanning its HTML, cached by modification time.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "app" / "library.yaml"
JOBS = ROOT / "sources" / "jobs"  # pipeline runs; each one with a built page is listed as a chapter

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


def load_library(path: Path = LIBRARY, jobs_dir: Path | None = None) -> list[Book]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    books = []
    for b in data.get("books", []):
        chapters = [Chapter(id=str(c["id"]), title=c["title"], path=c["path"], summary=c.get("summary", ""), made=c.get("made", ""))
                    for c in b.get("chapters", [])]
        books.append(Book(id=b["id"], title=b["title"], edition=b.get("edition", ""), authors=b.get("authors", []),
                          accent=b.get("accent", "#4cc9f0"), blurb=b.get("blurb", ""), chapters=chapters))
    return books + job_books(jobs_dir)


def _authors(upload_name: str) -> list[str]:
    """The first parenthesised list of names in a file name: '... (Marko Lukša, Kevin Conner) (z-lib.sk).pdf'."""
    for group in re.findall(r"\(([^)]*)\)", upload_name):
        names = [n.strip() for n in group.split(",")]
        if names and all(re.fullmatch(r"[^\W\d_][\w.'’-]*(?: [^\W\d_][\w.'’-]*){1,3}", n) for n in names):
            return names
    return []


def job_books(jobs_dir: Path | None = None) -> list[Book]:
    """Finished pipeline runs, one book per uploaded PDF and one chapter per run that built a page. Nothing to
    register: a run shows up here as soon as its page exists. Newest run first."""
    from pipeline.harness.page import book_name, run_chapter_id

    books: dict[str, Book] = {}
    for page in sorted((jobs_dir or JOBS).glob("*/page/dist/index.html"), reverse=True):
        jd = page.parents[2]
        try:
            spec = json.loads((jd / "job.json").read_text(encoding="utf-8"))
            report = json.loads((jd / "report.json").read_text(encoding="utf-8")) if (jd / "report.json").exists() else {}
        except (OSError, ValueError):
            continue
        name = spec.get("file", "")
        uid = spec.get("upload", jd.name)
        book = books.get(uid) or books.setdefault(uid, Book(
            id=f"upload-{uid}", title=book_name(name), edition="from an uploaded PDF", authors=_authors(name),
            accent="#8fb8ff", blurb="Chapters written by the readlab pipeline. Each run is listed separately, newest first."))
        secs = report.get("sections", {})
        scores = [j.get("overall") for j in report.get("judges", {}).values() if isinstance(j.get("overall"), (int, float))]
        when = time.strftime("%d %b %H:%M", time.localtime(spec.get("started", 0)))
        summary = (f"Run {when} · {sum(1 for s in secs.values() if s.get('pass'))}/{len(secs)} sections pass the checks"
                   + (f" · judge {sum(scores) / len(scores):.1f}/5" if scores else "")
                   + (f" · ${report['cost_usd']:.2f}" if "cost_usd" in report else ""))
        book.chapters.append(Chapter(id=run_chapter_id({"id": jd.name, **spec}), title=spec.get("chapter_title", jd.name),
                                     path=page.parent.as_posix(), summary=summary, made="pipeline"))  # absolute: ROOT / abs == abs
    return list(books.values())
