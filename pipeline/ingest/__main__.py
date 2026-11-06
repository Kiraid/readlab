"""CLI.

  python -m pipeline.ingest outline --book books/kia/book.yaml [--chapter 12]
  python -m pipeline.ingest fonts   --book books/kia/book.yaml --chapter 12
  python -m pipeline.ingest chapter --book books/kia/book.yaml --chapter 12
"""
from __future__ import annotations

import argparse
import sys

from .config import load_book
from .outline import chapter_range, read_outline


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.ingest")
    ap.add_argument("command", choices=["outline", "fonts", "chapter"])
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter", help="chapter number or a piece of its title")
    ap.add_argument("--id", help="chapter id to use when the outline has no numbers (e.g. 7)")
    args = ap.parse_args(argv)
    cfg = load_book(args.book)
    outline = read_outline(cfg.source, cfg.out_dir)

    if args.command == "outline":
        if args.chapter:
            rng = chapter_range(outline, args.chapter, 10**6, args.id)
            print(f"chapter {rng.id} {rng.chapter.title}: pdf pages {rng.first_page}-{rng.last_page}")
            for s in rng.sections:
                print(f"{'  ' * (s.level - 1)}{s.entry.page:4d}  {s.id:8s} {s.name}")
        else:
            for e in outline:
                print(f"{'  ' * e.level}{e.page:4d}  {e.title}")
        return 0

    if not args.chapter:
        ap.error("--chapter is required")
    rng = chapter_range(outline, args.chapter, 10**6, args.id)

    if args.command == "fonts":
        from .pdf_lines import font_histogram
        last = rng.last_page if rng.last_page < 10**6 else rng.first_page + 40
        print(f"{'chars':>7}  {'size':>5}  {'role':10}  font")
        for font, size, n, role in font_histogram(cfg.source, range(rng.first_page, last + 1), cfg):
            print(f"{n:7d}  {size:5.1f}  {role:10}  {font}")
        return 0

    from .run import ingest_chapter
    res = ingest_chapter(cfg, args.chapter, args.id)
    print((res["out"] / "report.md").read_text(encoding="utf-8"))
    print(f"wrote {res['out']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
