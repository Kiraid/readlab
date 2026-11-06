"""Sections -> chunks within a token budget. A chunk is the unit one writer call gets.

* A section over the max is split at prose boundaries (never inside a code block).
* A section under the min is merged: a short parent intro ("12.2" before "12.2.1") is carried
  forward into its first child; a short leaf joins the previous chunk if that fits.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .blocks import Block
from .sections import Section, render_block


def est_tokens(text: str) -> int:
    """~4 characters per token. Good enough for budgeting; the ledger records real counts later."""
    return max(1, len(text) // 4)


def block_tokens(b: Block) -> int:
    return est_tokens(render_block(b))


@dataclass
class Part:
    section: Section
    blocks: list[Block]
    part: int = 0  # 0 = whole section, 1.. = split pieces

    @property
    def tokens(self) -> int:
        return sum(block_tokens(b) for b in self.blocks) + est_tokens(self.section.title)


@dataclass
class Chunk:
    id: str
    parts: list[Part] = field(default_factory=list)

    @property
    def tokens(self) -> int:
        return sum(p.tokens for p in self.parts)

    @property
    def blocks(self) -> list[Block]:
        return [b for p in self.parts for b in p.blocks]

    @property
    def section_ids(self) -> list[str]:
        out = []
        for p in self.parts:
            if p.section.id not in out:
                out.append(p.section.id)
        return out


def split_section(s: Section, max_tokens: int) -> list[Part]:
    whole = Part(s, list(s.blocks))
    total = whole.tokens
    if total <= max_tokens:
        return [whole]
    n = -(-total // max_tokens)
    target = total / n
    parts, cur, acc = [], [], 0
    for b in s.blocks:
        t = block_tokens(b)
        # cut before a prose block once the current piece is big enough
        if cur and acc + t > target and b.kind in ("para", "subheading", "item") and len(parts) < n - 1:
            parts.append(cur)
            cur, acc = [], 0
        cur.append(b)
        acc += t
    parts.append(cur)
    return [Part(s, bl, i + 1) for i, bl in enumerate(parts)]


def make_chunks(sections: list[Section], min_tokens: int, max_tokens: int) -> list[Chunk]:
    parts = [p for s in sections for p in split_section(s, max_tokens)]
    chunks: list[Chunk] = []
    carry: list[Part] = []
    for i, p in enumerate(parts):
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        if p.tokens < min_tokens and p.part == 0:
            is_parent = nxt is not None and nxt.section.id.startswith(p.section.id + ".")
            if is_parent or not chunks:
                carry.append(p)
                continue
            prev = chunks[-1]
            same_parent = prev.parts[-1].section.id.rsplit(".", 1)[0] == p.section.id.rsplit(".", 1)[0]
            if same_parent and prev.tokens + p.tokens <= max_tokens and not carry:
                prev.parts.append(p)
                continue
            if nxt is not None:
                carry.append(p)
                continue
        chunks.append(Chunk(f"c{len(chunks) + 1:02d}", carry + [p]))
        carry = []
    if carry:
        if chunks:
            chunks[-1].parts.extend(carry)
        else:
            chunks.append(Chunk("c01", carry))
    return chunks
