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


def assign_sections(blocks: list[Block], rng: ChapterRange, cfg: BookConfig) -> tuple[list[Section], list[str]]:
    """Walk blocks in order; a heading whose number is in the outline opens that section.
    Returns sections and a list of warnings (outline entries never found in the text)."""
    ch = rng.chapter.number
    known = {e.number: e for e in rng.sections}
    extra = {norm(t): t for t in cfg.extra_sections}
    sections = [Section(ch, rng.chapter.name, 1)]
    found = set()
    for b in blocks:
        if b.kind == "heading":
            m = HEADING_NUM.match(b.text)
            if m and m.group(1) in known and m.group(1) not in found:
                e = known[m.group(1)]
                found.add(e.number)
                sections.append(Section(e.number, e.name, e.number.count(".") + 1))
                continue
            if norm(b.text) == norm(rng.chapter.name) or norm(b.text) == norm(rng.chapter.title):
                continue  # the chapter title itself
            if norm(b.text) in extra:
                name = extra[norm(b.text)]
                sections.append(Section(f"{ch}.{norm(name)}", name, 2))
                continue
            b.kind = "subheading"
        sections[-1].blocks.append(b)
    missing = [f"outline section {e.number} not found in text" for e in rng.sections if e.number not in found]
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
