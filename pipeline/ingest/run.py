"""Ingest one chapter: PDF -> lines -> blocks -> sections -> chunks + features, written to the book's out_dir.

Output (all under sources/, never committed):
  <out_dir>/ch<NN>/extract.json      sections, blocks, chunks, features, stats
  <out_dir>/ch<NN>/sections/*.md     one readable Markdown file per section
  <out_dir>/ch<NN>/chunks/*.md       the text each writer call will get
  <out_dir>/ch<NN>/files/*           code listings, named after the file the text mentions
  <out_dir>/ch<NN>/report.md         structure only (ids, titles, sizes, counts): safe to share
"""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from .blocks import build_blocks
from .chunk import make_chunks
from .config import BookConfig
from .features import annotate_listings, chunk_features, difficulty, term_candidates, prose_text
from .outline import chapter_range, read_outline, whole_document
from .pdf_lines import extract_lines
from .sections import render_block, render_section


def pdf_page_count(path: Path) -> int:
    from pypdf import PdfReader
    return len(PdfReader(str(path)).pages)


def ingest_chapter(cfg: BookConfig, chapter: str, chapter_id: str | None = None) -> dict:
    outline = read_outline(cfg.source, cfg.out_dir)
    if chapter == "__all__" or not outline:
        rng = whole_document(cfg.title, pdf_page_count(cfg.source) - 1, chapter_id or "1")
    else:
        rng = chapter_range(outline, chapter, last_pdf_page=10**6, chapter_id=chapter_id)
    if rng.last_page == 10**6:
        rng.last_page = pdf_page_count(cfg.source) - 1
    pages, stats = extract_lines(cfg.source, range(rng.first_page, rng.last_page + 1), cfg)
    blocks, bstats = build_blocks(pages, cfg)
    stats.update(bstats)

    from .sections import assign_sections
    sections, warnings = assign_sections(blocks, rng, cfg)
    for s in sections:
        annotate_listings(s.blocks)

    chunks = make_chunks(sections, cfg.chunk_min_tokens, cfg.chunk_max_tokens)
    df: Counter = Counter()
    for c in chunks:
        df.update(set(term_candidates(prose_text(c.blocks))))
    chunk_rows = []
    for c in chunks:
        chunk_rows.append({"id": c.id, "sections": c.section_ids,
                           "parts": [{"section": p.section.id, "part": p.part, "blocks": len(p.blocks)} for p in c.parts],
                           "est_tokens": c.tokens, "features": chunk_features(c.blocks, df, len(chunks))})
    difficulty(chunk_rows)
    # per-section features too: the validator checks each written section against its own source
    section_features = {s.id: chunk_features(s.blocks, df, len(chunks)) for s in sections}

    out = cfg.out_dir / (f"ch{int(rng.id):02d}" if rng.id.isdigit() else f"ch-{rng.id}")
    write_outputs(out, cfg, rng, sections, chunks, chunk_rows, stats, warnings, section_features)
    return {"out": out, "sections": sections, "chunks": chunk_rows, "chunk_objs": chunks, "stats": stats,
            "warnings": warnings, "range": rng}


def write_outputs(out: Path, cfg, rng, sections, chunks, chunk_rows, stats, warnings, section_features=None) -> None:
    for sub in ("sections", "chunks", "files"):
        d = out / sub
        d.mkdir(parents=True, exist_ok=True)
        for f in d.iterdir():
            f.unlink()

    for s in sections:
        (out / "sections" / f"{s.slug}.md").write_text(render_section(s), encoding="utf-8")

    for c in chunks:
        body = []
        for p in c.parts:
            head = f"## {p.section.id} {p.section.title}" + (f" (part {p.part})" if p.part else "")
            body.append("\n\n".join([head] + [render_block(b) for b in p.blocks]))
        (out / "chunks" / f"{c.id}.md").write_text("\n\n".join(body) + "\n", encoding="utf-8")

    used: Counter = Counter()
    for s in sections:
        for b in s.blocks:
            if b.kind == "code" and b.meta.get("listing"):
                ext = "yaml" if b.meta.get("yaml") else "txt"
                name = b.meta.get("file") or f"listing-{b.meta['listing']}.{ext}"
                used[name] += 1
                if used[name] > 1:
                    stem, dot, ext = name.rpartition(".")
                    name = f"{stem}-{used[name]}.{ext}" if dot else f"{name}-{used[name]}"
                b.meta["saved_as"] = name
                (out / "files" / name).write_text(b.text + "\n", encoding="utf-8")

    data = {
        "book": cfg.id, "chapter": rng.id, "title": rng.chapter.name,
        "pdf_pages": [rng.first_page, rng.last_page],
        "sections": [{"id": s.id, "slug": s.slug, "title": s.title, "level": s.level, "pages": s.pages,
                      "features": (section_features or {}).get(s.id, {}),
                      "blocks": [asdict(b) for b in s.blocks]} for s in sections],
        "chunks": chunk_rows,
        "stats": dict(stats),
        "warnings": warnings,
    }
    (out / "extract.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "report.md").write_text(report(data), encoding="utf-8")


def report(data: dict) -> str:
    """Structure only, no book text, so it can be pasted into an issue or shown in chat."""
    lines = [f"# Ingest report: {data['book']} ch{data['chapter']} {data['title']}", "",
             f"PDF pages {data['pdf_pages'][0]}-{data['pdf_pages'][1]} (0-based)", ""]
    lines += ["## Sections", "", "| id | title | pages | paras | code | listings | callouts | figures | ~tokens |",
              "|---|---|---|---|---|---|---|---|---|"]
    for s in data["sections"]:
        k = Counter(b["kind"] for b in s["blocks"])
        listings = sum(1 for b in s["blocks"] if b["kind"] == "code" and b["meta"].get("listing"))
        toks = sum(len(b["text"]) for b in s["blocks"]) // 4
        pages = f"{s['pages'][0]}-{s['pages'][1]}" if s["pages"] else "-"
        lines.append(f"| {s['id']} | {s['title']} | {pages} | {k['para']} | {k['code']} | {listings} | "
                     f"{k['callout']} | {k['figure']} | {toks} |")
    lines += ["", "## Chunks", "", "| chunk | sections | ~tokens | tier | difficulty | listings | commands | key terms |",
              "|---|---|---|---|---|---|---|---|"]
    for c in data["chunks"]:
        f = c["features"]
        lines.append(f"| {c['id']} | {', '.join(c['sections'])} | {c['est_tokens']} | {c['tier']} | {c['difficulty']} | "
                     f"{len(f['listings'])} | {len(f['commands'])} | {', '.join(f['key_terms'][:6])} |")
    files = [b["meta"]["saved_as"] for s in data["sections"] for b in s["blocks"] if b["meta"].get("saved_as")]
    lines += ["", "## Listings saved", "", ", ".join(files) or "(none)", "", "## Stats", ""]
    lines += [f"- {k}: {v}" for k, v in sorted(data["stats"].items())]
    if data["warnings"]:
        lines += ["", "## Warnings", ""] + [f"- {w}" for w in data["warnings"]]
    return "\n".join(lines) + "\n"
