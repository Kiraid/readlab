"""Lines -> reading-order blocks: headings, paragraphs, code, callouts, list items, captions.

Then three chapter-wide passes:
  * a listing that continues on the next page becomes one code block,
  * a paragraph interrupted by a figure, listing or page break is joined back together,
  * listing captions and side annotations are attached to their code block.
"""
from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import dataclass, field

from .config import BookConfig
from .pdf_lines import Line, Span

CAPTION_RE = re.compile(r"^(Listing|Figure|Table|Example)\s*(\d+[.-]\d+)\s*(.*)$")
# A caption set in the body font: the number is followed by "." or ":" ("Figure 2-3. Balanced tree",
# "Figure7.1: FIFO"), which prose that mentions a figure ("Figure 7-4 shows") doesn't have.
BODY_CAPTION_RE = re.compile(r"^(Listing|Figure|Table|Example)\s*(\d+[.-]\d+)\s*[.:]\s*\S")
CAPTION_KIND = {"Listing": "listing_caption", "Example": "listing_caption", "Figure": "figure", "Table": "table"}
FLOATS = {"code", "figure", "table", "callout", "listing_caption"}


@dataclass
class Block:
    kind: str  # heading, subheading, para, item, callout, code, listing_caption, figure, table
    text: str = ""
    page: int = 0
    top: float = 0.0
    bottom: float = 0.0
    x0: float = 0.0
    size: float = 0.0
    meta: dict = field(default_factory=dict)


# ---------------------------------------------------------------- line helpers

def render_line(ln: Line) -> str:
    """Prose rendering: inline code in backticks, italic prose (usually a newly defined term) in *stars*."""
    parts = []
    for i, s in enumerate(ln.spans):
        if s.role == "bullet":
            continue
        t = s.text
        if s.role == "code":
            t = f"`{re.sub(r' {2,}', ' ', t)}`"
        elif s.role == "body" and s.italic and t.strip():
            t = f"*{t}*"
        parts.append((" " if (parts and s.lead) else "") + t)
    text = "".join(parts).strip()
    return text.replace("``", "").replace("**", "")


def join_text(a: str, b: str) -> str:
    """Join two wrapped lines, undoing end-of-line hyphenation."""
    if not a:
        return b
    if a.endswith("-") and len(a) > 1 and a[-2].isalpha() and b[:1].islower():
        return a[:-1] + b
    return a + " " + b


def line_cells(ln: Line) -> list[tuple[float, str]]:
    """Split a table line into (x0, text) cells: at wide gaps between spans, and at 3+ spaces
    inside a monospace span (whose x positions are recovered from the character width)."""
    cells: list[list] = []
    prev_x1 = None
    for s in ln.spans:
        if s.role == "bullet":
            continue
        pieces = re.split(r"( {3,})", s.text) if s.role == "code" else [s.text]
        x = s.x0
        cw = s.char_width
        for k, piece in enumerate(pieces):
            if k % 2 == 1:  # a run of spaces
                x += len(piece) * cw
                prev_x1 = None  # force a new cell
                continue
            if not piece:
                continue
            text = f"`{piece.strip()}`" if s.role == "code" else piece.strip()
            if cells and prev_x1 is not None and x - prev_x1 <= 1.5 * s.size:
                cells[-1][1] += (" " if s.lead or k else "") + text
            else:
                cells.append([x, text])
            x += len(piece) * cw
            prev_x1 = x if s.role == "code" else s.x1
    return [(c[0], c[1].replace("``", "")) for c in cells]


def line_pieces(ln: Line) -> list[tuple[float, str]]:
    """Every span (and every 3+-space-separated part of a monospace span) with its x position."""
    out = []
    for s in ln.spans:
        if s.role == "bullet":
            continue
        if s.role != "code":
            out.append((s.x0, s.text.strip()))
            continue
        x = s.x0
        for k, piece in enumerate(re.split(r"( {3,})", s.text)):
            if piece.strip() and k % 2 == 0:
                out.append((x + (len(piece) - len(piece.lstrip())) * s.char_width, f"`{piece.strip()}`"))
            x += len(piece) * s.char_width
    return out


def build_table(lines: list[Line]) -> dict:
    """Column count = header cells. Column starts come from the data rows (headers are often centred):
    cluster the x positions of every row piece and keep the most-used clusters. Each piece goes to the
    column starting nearest at or left of it; a line with nothing in column 0 continues the previous row."""
    header = line_cells(lines[0])
    clusters: list[list[float]] = []
    for x in sorted(x for ln in lines[1:] for x, _ in line_pieces(ln)):
        if clusters and x - clusters[-1][-1] <= 10:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    top = sorted(clusters, key=len, reverse=True)[:len(header)]
    cols = sorted(min(c) for c in top) or [x for x, _ in header]
    if len(cols) < len(header):
        cols = [x for x, _ in header]
    hdr = [""] * len(cols)
    for x, text in header:
        idx = max([i for i, c in enumerate(cols) if c <= x + 4] or [0])
        hdr[idx] = (hdr[idx] + " " + text).strip()
    header = list(zip(cols, hdr))
    rows: list[list[str]] = []
    for ln in lines[1:]:
        row = [""] * len(cols)
        for x, text in line_pieces(ln):
            idx = max([i for i, c in enumerate(cols) if c <= x + 4] or [0])
            row[idx] = (row[idx] + " " + text).strip()
        if rows and not row[0]:
            rows[-1] = [(a + " " + b).strip() for a, b in zip(rows[-1], row)]
        else:
            rows.append(row)
    return {"header": [t for _, t in header], "rows": rows}


def body_margin(lines: list[Line]) -> float:
    xs = [round(ln.x0) for ln in lines if ln.roles == {"body"}]
    if not xs:
        return min((ln.x0 for ln in lines), default=0.0)
    return float(Counter(xs).most_common(1)[0][0])


def classify(ln: Line, cfg: BookConfig, margin: float) -> str:
    roles = ln.roles
    text = ln.plain.strip()
    if roles <= {"code"}:
        return "code"
    if "heading" in roles and roles <= {"heading", "bullet", "code"}:
        return "heading"
    first = ln.spans[0]
    label_re = re.compile(r"^(%s)\b" % "|".join(cfg.callout_labels))
    if roles <= {"body", "code"} and len(text) < 160:
        m = BODY_CAPTION_RE.match(text)
        if m:
            return CAPTION_KIND[m.group(1)]
    if first.role == "label":
        m = CAPTION_RE.match(text)
        if m:
            return CAPTION_KIND[m.group(1)]
        if label_re.match(text):
            return "callout"
        if roles <= {"label"}:
            return "subheading"  # run-in small-caps heading
    if label_re.match(text) and ln.x0 > margin + 4:
        return "callout"
    if first.role == "bullet":
        return "item"
    return "body"


# ---------------------------------------------------------------- one page

def page_blocks(lines: list[Line], cfg: BookConfig, margin: float) -> tuple[list[Block], list[dict]]:
    """Blocks for one page, plus the page's annotation fragments (handled chapter-wide later)."""
    annotations: list[dict] = []
    main: list[Line] = []
    for ln in lines:
        ann = [s for s in ln.spans if s.role == "annotation"]
        rest = [s for s in ln.spans if s.role != "annotation"]
        if ann:
            annotations.append({"page": ln.page, "top": min(s.top for s in ann), "bottom": max(s.bottom for s in ann),
                                "x0": ann[0].x0, "size": ann[0].size,
                                "text": "".join((" " if i and s.lead else "") + s.text for i, s in enumerate(ann))})
        if rest:
            main.append(Line(ln.page, rest))

    kinds = [classify(ln, cfg, margin) for ln in main]
    # A code-only line squeezed between two prose lines at normal leading is wrapped inline code.
    for i in range(1, len(main) - 1):
        if kinds[i] == "code" and kinds[i - 1] == "body" and kinds[i + 1] == "body":
            if main[i].top - main[i - 1].bottom < 0.8 * main[i - 1].size and \
                    main[i + 1].top - main[i].bottom < 0.8 * main[i + 1].size:
                kinds[i] = "body"
    # The lines after a table caption are rows until prose resumes at the margin.
    for i, kind in enumerate(kinds):
        if kind != "table":
            continue
        j = i + 1
        while j < len(main):
            ln, before = main[j], main[j - 1]
            prose = ln.roles <= {"body"} and ln.x0 <= margin + 4 and len(line_cells(ln)) == 1 \
                and len(ln.plain) > 40
            if prose or ln.top - before.bottom > 2.5 * ln.size or kinds[j] in ("heading", "table", "figure"):
                break
            kinds[j] = "table_row"
            j += 1

    blocks: list[Block] = []
    prev: Line | None = None
    for ln, kind in zip(main, kinds):
        gap = ln.top - prev.bottom if prev else 1e9
        cur = blocks[-1] if blocks else None
        size = ln.size

        def new(k: str, text: str, **meta) -> Block:
            b = Block(k, text, ln.page, ln.top, ln.bottom, ln.x0, size, meta)
            blocks.append(b)
            return b

        if kind == "table_row":
            table = next(b for b in reversed(blocks) if b.kind == "table")
            table.meta.setdefault("_lines", []).append(ln)
            table.bottom = ln.bottom
        elif kind == "code":
            raw = {"x0": ln.x0, "text": ln.plain, "page": ln.page, "bottom": ln.bottom,
                   "bold": sum(len(s.text) for s in ln.spans if s.bold) > sum(len(s.text) for s in ln.spans) / 2,
                   "cw": statistics.median(s.char_width for s in ln.spans), "blank_before": 0}
            if cur and cur.kind == "code" and gap <= 3.2 * size:
                raw["blank_before"] = max(0, round(gap / (1.25 * size)))
                cur.meta["raw"].append(raw)
                cur.bottom = ln.bottom
            else:
                new("code", "", raw=[raw], margin=margin)
        elif kind == "heading":
            text = re.sub(r"\s+", " ", ln.plain).strip()
            if cur and cur.kind == "heading" and abs(cur.size - size) < 0.2 and gap < size:
                cur.text = join_text(cur.text, text)
                cur.bottom = ln.bottom
            else:
                new("heading", text)
        elif kind in ("listing_caption", "figure", "table"):
            m = CAPTION_RE.match(ln.plain.strip())
            text = re.sub(r"^\*?(Listing|Figure|Table|Example)\s*\d+[.-]\d+\s*[.:]?\s*", "", render_line(ln)).strip("* ")
            new(kind, text, number=m.group(2) if m else "", italic=all(s.italic for s in ln.spans if s.text.strip()))
        elif kind == "subheading":
            text = re.sub(r"\s+", " ", ln.plain).strip()
            if cur and cur.kind == "subheading" and gap < size:
                cur.text += " " + text
            else:
                new("subheading", text)
        elif kind == "callout":
            text = render_line(ln)
            m = re.match(r"^(%s)\b\s*" % "|".join(cfg.callout_labels), text)
            new("callout", text[m.end():] if m else text, label=m.group(1) if m else "NOTE", x=ln.x0)
        elif kind == "item":
            text_x = next((s.x0 for s in ln.spans if s.role != "bullet"), ln.x0)
            new("item", render_line(ln), text_x=text_x)
        else:  # body
            text = render_line(ln)
            pitch_ok = gap <= 0.8 * size
            if cur and cur.kind == "callout" and gap <= 1.6 * size and abs(ln.x0 - cur.meta["x"]) <= 3:
                cur.text = join_text(cur.text, text)
            elif cur and cur.kind == "item" and pitch_ok and abs(ln.x0 - cur.meta["text_x"]) <= 3:
                cur.text = join_text(cur.text, text)
            elif cur and cur.kind in ("figure", "table", "listing_caption") and pitch_ok and (
                    (ln.size < 9.5 and "label" in ln.roles)
                    or (cur.meta.get("italic") and all(s.italic for s in ln.spans if s.text.strip()))):
                cur.text = join_text(cur.text, text.strip("*"))  # wrapped caption
            elif cur and cur.kind == "para" and pitch_ok and ln.x0 <= margin + 4:
                cur.text = join_text(cur.text, text)
            else:
                new("para", text, indented=ln.x0 > margin + 8)
            blocks[-1].bottom = ln.bottom
        prev = ln
    for b in blocks:
        if b.kind == "table":
            rows = b.meta.pop("_lines", [])
            if rows:
                b.meta.update(build_table(rows))
    return blocks, annotations


# ---------------------------------------------------------------- chapter-wide passes

def merge_code_across_pages(blocks: list[Block]) -> list[Block]:
    out: list[Block] = []
    for b in blocks:
        p = out[-1] if out else None
        if p and p.kind == "code" and b.kind == "code" and b.page == p.meta["raw"][-1]["page"] + 1:
            p.meta["raw"].extend(b.meta["raw"])
            p.meta.setdefault("page_margins", {})[b.page] = b.meta["margin"]
            continue
        out.append(b)
    return out


def finalize_code(b: Block) -> None:
    """Rebuild indentation from x positions. A continuation page has its own margin, so each page
    gets base = that page's margin + the listing's offset from the margin on its first page."""
    raw = b.meta.pop("raw")
    margins = {raw[0]["page"]: b.meta.pop("margin"), **b.meta.pop("page_margins", {})}
    cw = statistics.median(r["cw"] for r in raw) or 4.8
    first_page = raw[0]["page"]
    base_first = min(r["x0"] for r in raw if r["page"] == first_page)
    offset = base_first - margins[first_page]
    lines, bold, pos = [], [], []
    for r in raw:
        base = base_first if r["page"] == first_page else margins[r["page"]] + offset
        lines.extend([""] * r["blank_before"])
        lines.append(" " * max(0, round((r["x0"] - base) / cw)) + r["text"].rstrip())
        if r["bold"]:
            bold.append(len(lines))
        pos.append((r["page"], r["bottom"], len(lines)))
    b.text = "\n".join(lines)
    b.meta.update(bold_lines=bold, line_pos=pos, annotations=[])


def merge_paragraphs(blocks: list[Block]) -> list[Block]:
    """Join a paragraph that a float or page break interrupted mid-sentence."""
    def is_open(t: str) -> bool:
        t = t.rstrip().rstrip("”\"')*`")
        return bool(t) and t[-1] not in ".!?:"

    i = 0
    while i < len(blocks):
        a = blocks[i]
        if a.kind == "para" and is_open(a.text):
            j = i + 1
            while j < len(blocks) and blocks[j].kind in FLOATS and j - i <= 4:
                j += 1
            if j < len(blocks) and blocks[j].kind == "para" and not blocks[j].meta.get("indented") \
                    and blocks[j].page >= a.page:
                a.text = join_text(a.text, blocks[j].text)
                del blocks[j]
                continue  # the joined paragraph may still be open
        i += 1
    return blocks


def attach_captions(blocks: list[Block]) -> list[Block]:
    out: list[Block] = []
    skip = set()
    for i, b in enumerate(blocks):
        if i in skip:
            continue
        if b.kind == "listing_caption":
            for j in range(i + 1, min(i + 4, len(blocks))):
                if blocks[j].kind == "code":
                    blocks[j].meta.update(listing=b.meta["number"], caption=b.text)
                    break
            else:
                out.append(b)
            continue
        out.append(b)
    return out


def attach_annotations(blocks: list[Block], fragments: list[dict]) -> list[dict]:
    """Group annotation fragments into notes and pin each to the nearest code line. Returns orphans."""
    fragments.sort(key=lambda f: (f["page"], round(f["x0"]), f["top"]))
    notes: list[dict] = []
    for f in fragments:
        n = notes[-1] if notes else None
        if n and n["page"] == f["page"] and abs(n["x0"] - f["x0"]) <= 3 and f["top"] - n["bottom"] <= 0.8 * f["size"]:
            n["text"] = join_text(n["text"], f["text"])
            n["bottom"] = f["bottom"]
        else:
            notes.append(dict(f))
    codes = [b for b in blocks if b.kind == "code"]
    orphans = []
    for n in notes:
        centre = (n["top"] + n["bottom"]) / 2
        best = None
        for b in codes:
            for page, bottom, line_no in b.meta["line_pos"]:
                if page == n["page"]:
                    d = abs(bottom - 2 - centre)
                    if best is None or d < best[0]:
                        best = (d, b, line_no)
        if best and best[0] <= 30:
            best[1].meta["annotations"].append({"line": best[2], "text": n["text"]})
        else:
            orphans.append(n)
    for b in codes:
        b.meta["annotations"].sort(key=lambda a: a["line"])
    return orphans


def build_blocks(pages: dict[int, list[Line]], cfg: BookConfig) -> tuple[list[Block], dict]:
    blocks: list[Block] = []
    fragments: list[dict] = []
    for page in sorted(pages):
        lines = pages[page]
        bs, ann = page_blocks(lines, cfg, body_margin(lines))
        blocks.extend(bs)
        fragments.extend(ann)
    blocks = merge_code_across_pages(blocks)
    for b in blocks:
        if b.kind == "code":
            finalize_code(b)
    blocks = merge_paragraphs(blocks)
    blocks = attach_captions(blocks)
    orphans = attach_annotations(blocks, fragments)
    return blocks, {"annotation_orphans": len(orphans), "annotations": len(fragments)}
