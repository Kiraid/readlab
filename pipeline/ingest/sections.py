"""Assign blocks to the outline's sections, and render blocks back to Markdown."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .blocks import Block
from .config import BookConfig
from .outline import ChapterRange

HEADING_NUM = re.compile(r"^(\d+(?:\.\d+)+)\s*(.*)$")


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def slug(section_id: str) -> str:
    return "s" + re.sub(r"[^a-z0-9]+", "-", section_id.lower()).strip("-")


@dataclass
class Section:
    id: str
    title: str
    level: int  # 1 = chapter intro, 2 = 12.1, 3 = 12.1.1 ...
    blocks: list[Block] = field(default_factory=list)

    @property
    def slug(self) -> str:
        return slug(self.id)

    @property
    def pages(self) -> tuple[int, int] | None:
        ps = [b.page for b in self.blocks]
        return (min(ps), max(ps)) if ps else None


LEADING_NUM = re.compile(r"^\s*(?:chapter\s+)?\d+(?:\.\d+)*\.?\s*", re.I)
# A chapter's citation list, when it isn't an outline section of its own: everything from here to the chapter's
# end is skipped (DDIA prints ~1000 words of "[1] Author, Title…" after each Summary; the writer rightly skips
# them, and length and coverage were then measured against them).
END_MATTER = {"references", "bibliography"}


def assign_sections(blocks: list[Block], rng: ChapterRange, cfg: BookConfig) -> tuple[list[Section], list[str]]:
    """Walk blocks in order; a heading that matches an outline section opens it. A heading matches by its
    printed number when the outline has numbers, otherwise by title (the next unused section with that title).
    Returns sections and a list of warnings (outline entries never found in the text)."""
    ch = rng.id
    by_num = {s.entry.number: s for s in rng.sections if s.entry.number}
    extra = {norm(t): t for t in cfg.extra_sections}
    chapter_names = {norm(rng.chapter.name), norm(rng.chapter.title)}
    sections = [Section(ch, rng.chapter.name, 1)]
    found: set[str] = set()

    def open_section(s) -> None:
        found.add(s.id)
        sections.append(Section(s.id, s.name, s.level))

    for b in blocks:
        if b.kind in ("heading", "subheading") and norm(b.text) in END_MATTER \
                and not any(norm(s.name) == norm(b.text) for s in rng.sections):
            break
        if b.kind == "heading":
            m = HEADING_NUM.match(b.text)
            if m and m.group(1) in by_num and by_num[m.group(1)].id not in found:
                open_section(by_num[m.group(1)])
                continue
            title = norm(LEADING_NUM.sub("", b.text))
            if not title:
                continue  # a bare chapter number ("7") printed as a heading
            match = next((s for s in rng.sections if s.id not in found and norm(s.name) == title and title), None)
            if match:
                open_section(match)
                continue
            if title in chapter_names or norm(b.text) in chapter_names or (title and any(title in c or c in title for c in chapter_names) and len(b.text) < 80):
                continue  # the chapter title itself (sometimes with "CHAPTER 7" on the same line)
            if title in extra:
                name = extra[title]
                sections.append(Section(f"{ch}.{title}", name, 2))
                continue
            if not rng.sections:  # no outline below this chapter: every heading opens a section
                sections.append(Section(f"{ch}.{len(sections)}", re.sub(r"\s+", " ", LEADING_NUM.sub("", b.text)).strip(), 2))
                continue
            b.kind = "subheading"
        sections[-1].blocks.append(b)
    missing = [f"outline section {s.id} ({s.name}) not found in text" for s in rng.sections if s.id not in found]
    return sections, missing


def render_block(b: Block) -> str:
    k = b.kind
    if k == "heading":
        return f"## {b.text}"
    if k == "subheading":
        return f"#### {b.text}"
    if k == "para":
        return b.text
    if k == "item":
        return f"- {b.text}"
    if k == "callout":
        return f"> **{b.meta.get('label', 'NOTE')}** {b.text}"
    if k == "figure":
        return f"[Figure {b.meta.get('number', '')}: {b.text}]"
    if k == "table":
        out = f"**Table {b.meta.get('number', '')}** {b.text}"
        if b.meta.get("header"):
            head = b.meta["header"]
            out += "\n\n| " + " | ".join(head) + " |\n|" + "---|" * len(head)
            for r in b.meta["rows"]:
                out += "\n| " + " | ".join(c.replace("|", "\\|") for c in r) + " |"
        return out
    if k == "listing_caption":
        return f"**Listing {b.meta.get('number', '')}** {b.text}"
    if k == "code":
        head = ""
        if b.meta.get("listing"):
            name = f" ({b.meta['file']})" if b.meta.get("file") else ""
            head = f"**Listing {b.meta['listing']}**{name} {b.meta.get('caption', '')}\n"
        body = f"{head}```\n{b.text}\n```"
        if b.meta.get("annotations"):
            body += "\n" + "\n".join(f"  - line {a['line']}: {a['text']}" for a in b.meta["annotations"])
        return body
    return b.text


def render_section(s: Section) -> str:
    hashes = "#" * min(s.level + 1, 4)
    head = f"{hashes} {s.id} {s.title}" if s.level > 1 else f"# {s.id} {s.title}"
    return "\n\n".join([head] + [render_block(b) for b in s.blocks]) + "\n"
