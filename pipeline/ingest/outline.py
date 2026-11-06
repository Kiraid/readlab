"""PDF outline (bookmarks) -> chapter and section page ranges."""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

NUMBERED = re.compile(r"^(\d+(?:\.\d+)*)\s+(.*)$")


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
class ChapterRange:
    chapter: Entry
    sections: list[Entry]  # numbered entries below the chapter, in order
    first_page: int
    last_page: int


def chapter_range(entries: list[Entry], chapter: str, last_pdf_page: int) -> ChapterRange:
    for i, e in enumerate(entries):
        if e.number == chapter:
            break
    else:
        raise KeyError(f"chapter {chapter} not found in the PDF outline")
    sections = []
    end = last_pdf_page
    for f in entries[i + 1:]:
        if f.level <= e.level:
            end = f.page - 1
            break
        if f.number and f.number.startswith(chapter + "."):
            sections.append(f)
    return ChapterRange(e, sections, e.page, end)
