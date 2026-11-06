from pathlib import Path

from pipeline.ingest.config import BookConfig
from pipeline.ingest.pdf_lines import Line, Span

CFG = BookConfig(id="t", title="t", source=Path("none.pdf"), out_dir=Path("out"), font_rules=[])

FONTS = {"body": "Serif-Roman", "code": "Mono", "label": "Sans-Demi", "heading": "Sans-DemiItal",
         "annotation": "Narrow", "bullet": "Dingbats"}


def span(text, x0, top, role="body", size=10.0, font=None, lead=0, cw=None):
    cw = cw or (4.8 if role == "code" else size * 0.5)
    return Span(role, text, font or FONTS[role], size, x0, x0 + cw * len(text), top, top + size, lead)


def line(text, x0, top, role="body", size=10.0, page=1, font=None):
    return Line(page, [span(text, x0, top, role, size, font)])


def mixed(page, top, *parts):
    """parts: (text, x0, role[, size]) tuples, all on one baseline."""
    spans = []
    for k, p in enumerate(parts):
        text, x0, role, *rest = p
        size = rest[0] if rest else (8.0 if role == "code" else 10.0)
        spans.append(span(text, x0, top + (10 - size), role, size, lead=1 if k else 0))
    return Line(page, spans)
