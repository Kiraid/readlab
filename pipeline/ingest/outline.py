"""PDF outline (bookmarks) -> chapter and section page ranges.

Books number their outlines differently:
  "12.2.1 Exposing a service"        (Kubernetes in Action)
  "Chapter 7. Transactions"          (O'Reilly books)
  "Scheduling: Introduction"         (no numbers at all, e.g. OSTEP)
A chapter can be picked by number or by a piece of its title. Sections keep their printed number when
they have one; otherwise they get one from their position ("7.1", "7.1.2"), so ids stay stable per book.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

NUMBERED = re.compile(r"^(?:chapter\s+|part\s+)?(\d+(?:\.\d+)*)\.?\s+(.*)$", re.I)


@dataclass
class Entry:
    level: int
    title: str
    page: int  # 0-based page index

    @property
    def number(self) -> str | None:
        m = NUMBERED.match(self.title)
        return m.group(1) if m else None

    @property
    def name(self) -> str:
        m = NUMBERED.match(self.title)
        return m.group(2) if m else self.title


def read_outline(pdf_path: Path, cache_dir: Path | None = None) -> list[Entry]:
    """Read the bookmark tree. Cached next to the extraction output, keyed by file size and mtime."""
    stat = pdf_path.stat()
    key = {"size": stat.st_size, "mtime": int(stat.st_mtime)}
    cache = cache_dir / "outline.json" if cache_dir else None
    if cache and cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("key") == key:
            return [Entry(**e) for e in data["entries"]]

    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    entries: list[Entry] = []

    def walk(items, depth=0):
        for it in items:
            if isinstance(it, list):
                walk(it, depth + 1)
            else:
                entries.append(Entry(depth, it.title.strip(), reader.get_destination_page_number(it)))

    walk(reader.outline)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"key": key, "entries": [asdict(e) for e in entries]}, indent=1), encoding="utf-8")
    return entries


@dataclass
class SectionEntry:
    entry: Entry
    id: str      # "12.2.1", or positional "7.3" when the outline has no numbers
    level: int   # 2 = first level below the chapter, 3 = the next ...

    @property
    def name(self) -> str:
        return self.entry.name


@dataclass
class ChapterRange:
    chapter: Entry
    id: str
    sections: list[SectionEntry]
    first_page: int
    last_page: int


def find_chapter(entries: list[Entry], selector: str) -> int:
    """Index of the chapter: "#12" is an outline index; otherwise exact number first, then the first title
    containing the selector."""
    if selector.startswith("#") and selector[1:].isdigit() and int(selector[1:]) < len(entries):
        return int(selector[1:])
    for i, e in enumerate(entries):
        if e.number == selector:
            return i
    low = selector.lower()
    for i, e in enumerate(entries):
        if low in e.title.lower():
            return i
    raise KeyError(f"chapter {selector!r} not found in the PDF outline")


def whole_document(title: str, last_pdf_page: int, chapter_id: str = "1") -> ChapterRange:
    """No outline (an article, a paper, a docs export): the whole file is one chapter, and its sections come
    from the headings found in the text."""
    return ChapterRange(Entry(0, title, 0), chapter_id, [], 0, last_pdf_page)


def chapter_range(entries: list[Entry], selector: str, last_pdf_page: int, chapter_id: str | None = None) -> ChapterRange:
    i = find_chapter(entries, selector)
    e = entries[i]
    cid = chapter_id or e.number or re.sub(r"[^a-z0-9]+", "-", e.title.lower()).strip("-")
    sections: list[SectionEntry] = []
    counters: list[int] = []
    end = last_pdf_page
    for f in entries[i + 1:]:
        if f.level <= e.level:
            end = f.page - 1
            break
        depth = f.level - e.level  # 1 = directly below the chapter
        counters = (counters + [0] * depth)[:depth]
        counters[-1] += 1
        sid = f.number if f.number and f.number.startswith(cid + ".") else ".".join([cid] + [str(c) for c in counters])
        sections.append(SectionEntry(f, sid, depth + 1))
    return ChapterRange(e, cid, sections, e.page, end)
