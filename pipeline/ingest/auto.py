"""Calibration for documents nobody wrote a book.yaml for (uploads).

From the fonts on a sample of pages:
  body     the font/size with the most characters, and anything set within 0.85-1.12x that size
  code     any monospace-looking font
  heading  the exact font/size of lines that match outline titles, plus anything noticeably larger than body
  label    the font that starts caption and callout lines ("Listing 3.1", "NOTE")
  annotation  a non-body font whose words mostly sit to the right of code on the same line
  dropped  everything else: figure labels, footnotes, superscripts
Word gaps: if too many "words" come out absurdly long, the book is set tightly and needs a smaller x_tolerance.
Running heads, footers and watermarks are found by repetition (auto_margins).
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from .config import BookConfig, FontRule, base_font

CALIBRATION_VERSION = 2  # bump when the rules change, so cached calibrations are rebuilt
MONO = re.compile(r"mono|courier|consol|code|menlo|inconsolata|lucidatypewriter|nimbusmon|lettergothic|ocr", re.I)


def font_stats(pdf_path: Path, pages: list[int]) -> Counter:
    import pdfplumber

    hist: Counter = Counter()
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i in pages:
            if i < len(pdf.pages):
                for c in pdf.pages[i].chars:
                    if c["text"].strip():
                        hist[(base_font(c["fontname"]), round(float(c["size"]), 1))] += 1
    return hist


def long_word_ratio(pdf_path: Path, pages: list[int], x_tolerance: float) -> float:
    import pdfplumber

    total = long = 0
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i in pages:
            if i < len(pdf.pages):
                for w in pdf.pages[i].extract_words(x_tolerance=x_tolerance):
                    t = w["text"]
                    if t.isalpha():
                        total += 1
                        long += len(t) > 20
    return long / max(1, total)


BULLET = re.compile(r"wingding|dingbat|zapf", re.I)


def family(font: str) -> str:
    """'MinionPro-It' -> 'MinionPro', 'JetBrainsMonoNL,Bold' -> 'JetBrainsMonoNL'."""
    return re.split(r"[-,]", font, maxsplit=1)[0]


LABEL_LINE = re.compile(r"^(?:(?:Listing|Figure|Table|Example)\s*\d+[.-]\d+|(?:NOTE|TIP|WARNING|DEFINITION|IMPORTANT|CAUTION)\b)")


def _letters(text: str) -> str:
    """Compare titles by their letters only: '14.1.1Creating a ReplicaSet' == '14.1.1 Creating a ReplicaSet'."""
    return re.sub(r"[^a-z]", "", re.sub(r"^\s*(?:chapter\s+|part\s+)?[\d.]+\s*", "", text.lower()))


def marker_fonts(pdf_path: Path, pages: list[int], titles: list[str]) -> dict[str, Counter]:
    """Fonts that mark structure, learnt from the document itself:
      heads    (font, size) of lines whose text is an outline title
      labels   (font, size) that starts "Listing 3.1 ..." / "NOTE ..." lines
      beside   per font, words that sit to the right of code on the same line (listing annotations), of `words`"""
    import pdfplumber

    want = {k for k in map(_letters, titles) if len(k) >= 6}
    heads: Counter = Counter()
    labels: Counter = Counter()
    beside: Counter = Counter()
    total: Counter = Counter()
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i in pages:
            if i >= len(pdf.pages):
                continue
            page = pdf.pages[i]
            words = [w for w in page.extract_words(extra_attrs=["fontname", "size"])
                     if 0.08 * page.height < w["top"] < 0.92 * page.height]  # running heads repeat section titles
            code = [w for w in words if MONO.search(w["fontname"])]
            rows: dict[int, list] = {}
            for w in words:
                f = base_font(w["fontname"])
                if not MONO.search(f):
                    total[f] += 1
                    if any(c["x1"] + 6 < w["x0"] and min(c["bottom"], w["bottom"]) - max(c["top"], w["top"]) > 1 for c in code):
                        beside[f] += 1
                rows.setdefault(round(w["top"] / 2), []).append(w)
            for row in rows.values():
                row.sort(key=lambda w: w["x0"])
                text = " ".join(w["text"] for w in row)
                fonts = Counter((base_font(w["fontname"]), round(float(w["size"]), 1)) for w in row)
                if want and _letters(text) in want:
                    heads[fonts.most_common(1)[0][0]] += 1
                elif LABEL_LINE.match(text):
                    labels[(base_font(row[0]["fontname"]), round(float(row[0]["size"]), 1))] += 1
    return {"heads": heads, "labels": labels, "beside": beside, "words": total}


def rules_from_stats(hist: Counter, marks: dict[str, Counter] | None = None) -> tuple[list[FontRule], float]:
    prose = Counter({k: v for k, v in hist.items() if not MONO.search(k[0])})
    if not prose:
        return [FontRule(re.compile(".*"), "body")], 10.0
    (body_font, body_size), _ = prose.most_common(1)[0]
    marks = marks or {}
    rules = [FontRule(re.compile(re.escape(f)), "code", min_size=body_size * 0.6) for f in {k[0] for k in hist if MONO.search(k[0])}]
    rules.append(FontRule(BULLET, "bullet"))
    exact = lambda f: re.compile("^" + re.escape(f) + "$")  # noqa: E731
    # Learnt marker fonts from the body's own family (its italic, its bold) are left to the size rules: books set
    # captions and emphasis in them, and a stray title match would turn every caption into a heading.
    own = lambda f: family(f) == family(body_font) or MONO.search(f) or BULLET.search(f)  # noqa: E731
    heads = marks.get("heads", Counter())
    head_fonts = {k for k, n in heads.items() if n >= 2 and not own(k[0])}
    for f, size in sorted(head_fonts):  # headings set at (or near) body size, which the size rule below misses
        rules.append(FontRule(exact(f), "heading", min_size=size - 0.3, max_size=size + 0.3))
    for fam in sorted({family(f) for f, _ in head_fonts}):  # deeper headings not in the outline: same family, >= body size
        rules.append(FontRule(re.compile("^" + re.escape(fam) + r"([-,]|$)"), "heading", min_size=body_size))
    taken = {body_font} | {f for f, _ in head_fonts}
    words, beside = marks.get("words", Counter()), marks.get("beside", Counter())
    for f in sorted(f for f, n in beside.items() if f not in taken and not own(f) and n >= 20 and n >= 0.5 * words[f]):
        rules.append(FontRule(exact(f), "annotation"))  # notes set beside listing lines
        taken.add(f)
    for f in sorted({f for f, _ in marks.get("labels", Counter()) if f not in taken and not own(f)}):
        rules.append(FontRule(exact(f), "label", min_size=round(body_size * 0.6, 2)))
    rules += [FontRule(re.compile(".*"), "heading", min_size=round(body_size * 1.12, 2)),
              FontRule(re.compile(".*"), "body", min_size=round(body_size * 0.85, 2), max_size=round(body_size * 1.12, 2))]
    return rules, body_size


def calibrate(pdf_path: Path, sample: list[int] | None = None) -> tuple[list[FontRule], float]:
    """Font rules and word tolerance for a PDF. Cached beside the PDF (keyed by size and mtime): every job on the
    same upload reuses it instead of re-reading ~25 pages."""
    from pypdf import PdfReader

    from .outline import read_outline

    stat = pdf_path.stat()
    key = {"size": stat.st_size, "mtime": int(stat.st_mtime), "v": CALIBRATION_VERSION}
    cache = pdf_path.with_name(pdf_path.name + ".calibration.json")
    if sample is None and cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("key") == key:
                return [FontRule(re.compile(r["pattern"], re.I if r.get("i") else 0), r["role"], r["min"], r["max"])
                        for r in data["rules"]], data["x_tolerance"]
        except (ValueError, KeyError):
            pass
    n = len(PdfReader(str(pdf_path)).pages)
    sample = sample or sorted({min(n - 1, max(0, round(n * f))) for f in (0.2, 0.35, 0.5, 0.65, 0.8)})
    outline = read_outline(pdf_path)
    entry_pages = sorted({e.page for e in outline})
    entry_pages = entry_pages[:: max(1, len(entry_pages) // 12)][:12]  # up to 12 heading pages, spread out
    marks = marker_fonts(pdf_path, sorted(set(entry_pages) | set(sample)), [e.title for e in outline])
    rules, _ = rules_from_stats(font_stats(pdf_path, sample), marks)
    tol = 0.9 if long_word_ratio(pdf_path, sample, 1.5) > 0.015 else 1.5
    try:
        cache.write_text(json.dumps({"key": key, "x_tolerance": tol, "rules": [
            {"pattern": r.pattern.pattern, "i": bool(r.pattern.flags & re.I), "role": r.role, "min": r.min_size, "max": r.max_size}
            for r in rules]}, indent=1), encoding="utf-8")
    except OSError:
        pass
    return rules, tol


def auto_book_config(pdf_path: Path, out_dir: Path, title: str, sample: list[int] | None = None) -> BookConfig:
    rules, tol = calibrate(pdf_path, sample)
    cfg = BookConfig(id=out_dir.name, title=title, source=pdf_path, out_dir=out_dir, font_rules=rules,
                     margin_top=0.0, margin_bottom=1.0, x_tolerance=tol)
    cfg.auto_margins = True
    return cfg
