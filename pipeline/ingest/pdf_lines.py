"""PDF page -> visual lines made of font-role spans.

pdfplumber gives words with font name and size. Each word gets a role from the book's font
rules; words on the same baseline become one Line; adjacent words with the same font merge
into Spans. Spacing is rebuilt from the gaps, so small caps ("C" + "REATING") glue back
together and monospace column alignment survives.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .config import BookConfig, base_font


@dataclass
class Span:
    role: str
    text: str
    font: str
    size: float
    x0: float
    x1: float
    top: float
    bottom: float
    lead: int = 0  # spaces before this span; 0 = glued to the previous span

    @property
    def bold(self) -> bool:
        return "Bold" in self.font

    @property
    def italic(self) -> bool:
        return "Italic" in self.font or "Oblique" in self.font

    @property
    def char_width(self) -> float:
        return (self.x1 - self.x0) / max(1, len(self.text))


@dataclass
class Line:
    page: int
    spans: list[Span] = field(default_factory=list)

    @property
    def top(self) -> float:
        return min(s.top for s in self.spans)

    @property
    def bottom(self) -> float:
        return max(s.bottom for s in self.spans)

    @property
    def x0(self) -> float:
        return self.spans[0].x0

    @property
    def roles(self) -> set[str]:
        return {s.role for s in self.spans}

    @property
    def size(self) -> float:
        sizes = [s.size for s in self.spans if s.role != "bullet"]
        return max(sizes) if sizes else self.spans[0].size

    @property
    def plain(self) -> str:
        return "".join((" " * s.lead if i else "") + s.text for i, s in enumerate(self.spans))


def words_to_lines(words: list[dict], role_of: Callable[[str, float], str], page: int,
                   y_tol: float = 3.0, stats: Counter | None = None) -> list[Line]:
    """Group pdfplumber-style word dicts into Lines. Words whose role is 'drop' are skipped."""
    items = []
    for w in words:
        font = base_font(w["fontname"])
        size = round(float(w["size"]), 1)
        role = role_of(font, size)
        if role == "drop":
            if stats is not None:
                stats[f"dropped_font:{font}"] += len(w["text"])
            continue
        items.append({**w, "font": font, "size": size, "role": role})

    # Cluster by baseline. Bottoms (not tops) line up when an 8pt inline code word sits in 10pt text.
    items.sort(key=lambda it: (it["bottom"], it["x0"]))
    groups: list[list[dict]] = []
    anchor = None
    for it in items:
        if groups and abs(it["bottom"] - anchor) <= y_tol:
            groups[-1].append(it)
        else:
            groups.append([it])
            anchor = it["bottom"]

    lines = []
    for g in groups:
        g.sort(key=lambda it: it["x0"])
        spans: list[Span] = []
        prev = None
        for it in g:
            lead = 0
            if prev is not None:
                gap = it["x0"] - prev["x1"]
                if gap >= 0.12 * it["size"]:
                    if it["role"] == "code" and prev["role"] == "code":
                        cw = (it["x1"] - it["x0"]) / max(1, len(it["text"]))
                        lead = max(1, round(gap / cw))
                    else:
                        lead = 1
            cur = spans[-1] if spans else None
            # a wide gap in prose means a new table cell, so start a new span there
            wide = prev is not None and it["role"] != "code" and it["x0"] - prev["x1"] > 0.9 * it["size"]
            if cur and not wide and cur.role == it["role"] and cur.font == it["font"] and cur.size == it["size"]:
                cur.text += " " * lead + it["text"]
                cur.x1 = it["x1"]
                cur.top = min(cur.top, it["top"])
                cur.bottom = max(cur.bottom, it["bottom"])
            else:
                spans.append(Span(it["role"], it["text"], it["font"], it["size"], it["x0"], it["x1"],
                                  it["top"], it["bottom"], lead))
            prev = it
        lines.append(Line(page, spans))
    lines.sort(key=lambda ln: (ln.top, ln.x0))
    return lines


def extract_lines(pdf_path: Path, pages: range, cfg: BookConfig) -> tuple[dict[int, list[Line]], Counter]:
    import pdfplumber

    stats: Counter = Counter()
    out: dict[int, list[Line]] = {}
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i in pages:
            page = pdf.pages[i]
            h = page.height
            words = page.extract_words(x_tolerance=1.5, y_tolerance=2, extra_attrs=["fontname", "size"])
            kept = []
            for w in words:
                if w["top"] < cfg.margin_top * h or w["top"] > cfg.margin_bottom * h:
                    stats["dropped_margin_words"] += 1
                    continue
                kept.append(w)
            lines = []
            for ln in words_to_lines(kept, cfg.role, i, stats=stats):
                # a lone page number near the bottom (chapter-opener pages put it there)
                if ln.top > 0.85 * h and ln.plain.strip().isdigit() and "code" not in ln.roles:
                    stats["dropped_page_numbers"] += 1
                    continue
                lines.append(ln)
            out[i] = lines
            stats["lines"] += len(lines)
    return out, stats


def font_histogram(pdf_path: Path, pages: range, cfg: BookConfig) -> list[tuple[str, float, int, str]]:
    import pdfplumber

    hist: Counter = Counter()
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i in pages:
            for c in pdf.pages[i].chars:
                hist[(base_font(c["fontname"]), round(float(c["size"]), 1))] += 1
    return [(f, s, n, cfg.role(f, s)) for (f, s), n in hist.most_common()]
