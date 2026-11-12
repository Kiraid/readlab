"""The hand-built chapters listed in app/library.yaml (read by `cli import-legacy`), and helpers the database-backed
library shares: what a page contains (COUNTERS) and author names from an upload's file name.
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


def load_library(path: Path = LIBRARY) -> list[Book]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    books = []
    for b in data.get("books", []):
        chapters = [Chapter(id=str(c["id"]), title=c["title"], path=c["path"], summary=c.get("summary", ""), made=c.get("made", ""))
                    for c in b.get("chapters", [])]
        books.append(Book(id=b["id"], title=b["title"], edition=b.get("edition", ""), authors=b.get("authors", []),
                          accent=b.get("accent", "#4cc9f0"), blurb=b.get("blurb", ""), chapters=chapters))
    return books


def _authors(upload_name: str) -> list[str]:
    """The first parenthesised list of names in a file name: '... (Marko Lukša, Kevin Conner) (z-lib.sk).pdf'."""
    for group in re.findall(r"\(([^)]*)\)", upload_name):
        names = [n.strip() for n in group.split(",")]
        if names and all(re.fullmatch(r"[^\W\d_][\w.'’-]*(?: [^\W\d_][\w.'’-]*){1,3}", n) for n in names):
            return names
    return []
