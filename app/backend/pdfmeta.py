"""What the app learns from a PDF at upload: cover, accent colour, words per page, title and authors, and a printed
number for each chapter. No model calls; pypdfium2 is fast enough to read every page."""
from __future__ import annotations

import colorsys
import re
from pathlib import Path

from pipeline.harness.page import book_name
from pipeline.ingest.outline import NUMBERED

COVER_WIDTH = 480
CHAPTER_PREFIX = re.compile(r"^(?:chapter|ch\.?)\s+(\d{1,3})\s*[.:\-–—]?\s+(.+)$|^(\d{1,3})\s*[.:]?\s+(.+)$", re.I)


def page_texts(pdf: Path) -> list[str]:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    try:
        out = []
        for i in range(len(doc)):
            page = doc[i]
            tp = page.get_textpage()
            out.append(tp.get_text_range() or "")
            tp.close()
            page.close()
        return out
    finally:
        doc.close()


def render_cover(pdf: Path, out: Path) -> str | None:
    """The first page as a WebP, and an accent colour taken from it (the most common saturated colour)."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    try:
        page = doc[0]
        w = page.get_width() or 1
        img = page.render(scale=max(0.5, min(3.0, COVER_WIDTH / w))).to_pil().convert("RGB")
        page.close()
    finally:
        doc.close()
    img.save(out, "WEBP", quality=82, method=5)
    return accent_of(img)


def accent_of(img) -> str | None:
    small = img.resize((64, int(64 * img.height / max(1, img.width))))
    best, score = None, 0.0
    for count, (r, g, b) in small.getcolors(64 * 128) or []:
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if 0.25 < l < 0.75 and s > 0.35:
            sc = count * s
            if sc > score:
                best, score = (h, s), sc
    if not best:
        return None
    r, g, b = colorsys.hls_to_rgb(best[0], 0.62, min(0.85, max(0.55, best[1])))  # light enough for a dark UI
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def authors_from_name(filename: str) -> list[str]:
    from app.backend.library import _authors

    return [re.sub(r"\s+etc\.?$", "", a) for a in _authors(filename)]


def guess_meta(pdf: Path, filename: str) -> dict:
    """Title, subtitle and authors: the PDF's own metadata when it looks real, else the file name."""
    from pypdf import PdfReader

    title, authors = "", authors_from_name(filename)
    try:
        info = PdfReader(str(pdf)).metadata or {}
        t = str(info.get("/Title") or "").strip()
        if t and len(t) > 3 and not re.search(r"untitled|microsoft word|\.(pdf|docx?|indd)$|^[\w-]+\d{3,}", t, re.I):
            title = t
        a = str(info.get("/Author") or "").strip()
        if not authors and a and len(a) < 200:
            authors = [x.strip() for x in re.split(r";|,| and |&", a) if x.strip()][:6]
    except Exception:  # noqa: BLE001  (broken metadata is common)
        pass
    full = title or re.sub(r"\.pdf$", "", re.sub(r"\([^)]*\)", " ", filename), flags=re.I).strip()
    short = book_name(full + ".pdf") if not title else re.split(r":\s|\s[-–]\s", title, maxsplit=1)[0].strip()
    subtitle = full[len(short):].strip(" :-–,") if full.startswith(short) else ""
    subtitle = re.sub(r"[-_\s]+\d+[-_]\d+\s*$", "", subtitle).strip()
    edition = ""
    m = re.search(r"\b(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth)\s+edition\b", full, re.I)
    if m:
        edition = m.group(0)
        subtitle = re.sub(r",?\s*" + re.escape(edition), "", subtitle, flags=re.I).strip(" ,")
    return {"title": short or "Untitled document", "subtitle": subtitle[:200], "authors": authors, "edition": edition}


def split_number(title: str) -> tuple[str, str]:
    """'Chapter 7. Transactions' -> ('7', 'Transactions'); '14 Scaling pods' -> ('14', 'Scaling pods')."""
    m = CHAPTER_PREFIX.match(title.strip())
    if m:
        num, rest = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        return num, rest.strip()
    m = NUMBERED.match(title.strip())
    if m and "." not in m.group(1):
        return m.group(1), m.group(2).strip()
    return "", title.strip()


def printed_number(first_page: str, title: str) -> str:
    """A chapter whose bookmark has no number often prints one on a line of its own just above the title."""
    lines = [ln.strip() for ln in first_page.splitlines()[:8]]
    want = re.sub(r"[^a-z]", "", title.lower())
    for a, b in zip(lines, lines[1:]):
        line = re.sub(r"[^a-z]", "", b.lower())
        if re.fullmatch(r"\d{1,3}", a) and len(line) >= 5 and (line.startswith(want[:12]) or want.startswith(line)):
            return a
    return ""


def words_in(texts: list[str], first: int, last: int) -> int:
    return sum(len(texts[p - 1].split()) for p in range(max(1, first), min(len(texts), last) + 1))
