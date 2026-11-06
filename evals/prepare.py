"""Prepare eval cases: clip the source, build the writer prompt, write everything the scorer needs.

  ./run.sh python -m evals.prepare [case-id ...]

For each case in evals/cases/*.yaml this reads the ingested chapter (sources/<book>/<chapter_dir>/extract.json),
merges the listed sections into one section (later ones become #### sub-headings), optionally clips it to a
token budget at a paragraph boundary, recomputes its features, copies the listings it uses, and writes:

  sources/evals/<id>/source.json    the clipped section in extract.json shape (the validator's reference)
  sources/evals/<id>/files/         listings the snippet uses
  sources/evals/<id>/prompt.json    {system, user, meta}: exactly what the writer model receives
  sources/evals/<id>/prompt.md      the same, readable
  sources/evals/<id>/case.yaml      a copy of the case

Everything lands under sources/ because it contains book text; none of it is committed.
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter
from pathlib import Path

import yaml

from pipeline.ingest.blocks import Block
from pipeline.ingest.config import ROOT
from pipeline.ingest.features import chunk_features
from pipeline.ingest.sections import render_block
from pipeline.prompts.assemble import est_tokens, writer_prompt

CASES = ROOT / "evals" / "cases"
OUT = ROOT / "sources" / "evals"
SPLIT_KINDS = {"para", "subheading", "item", "callout"}


def merge_sections(extract: dict, ids: list[str], title: str | None) -> dict:
    by_id = {str(s["id"]): s for s in extract["sections"]}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise KeyError(f"sections {missing} not in the extract (have {sorted(by_id)[:12]}…)")
    blocks: list[dict] = []
    for k, sid in enumerate(ids):
        s = by_id[sid]
        if k > 0:
            blocks.append({"kind": "subheading", "text": s["title"], "page": s["blocks"][0]["page"] if s["blocks"] else 0,
                           "top": 0.0, "bottom": 0.0, "x0": 0.0, "size": 0.0, "meta": {}})
        blocks.extend(s["blocks"])
    first = by_id[ids[0]]
    return {"id": first["id"], "title": title or first["title"], "level": first.get("level", 2), "blocks": blocks}


def clip(blocks: list[dict], max_tokens: int | None) -> list[dict]:
    """Keep blocks from the start until the budget; cut only before a prose block, never inside code."""
    if not max_tokens:
        return blocks
    out, used = [], 0
    for b in blocks:
        t = est_tokens(render_block(Block(**b)))
        if out and used + t > max_tokens and b["kind"] in SPLIT_KINDS:
            break
        out.append(b)
        used += t
    return out


def prepare(case_path: Path) -> dict:
    case = yaml.safe_load(case_path.read_text(encoding="utf-8"))
    chapter = ROOT / "sources" / case["book"] / case["chapter_dir"]
    extract = json.loads((chapter / "extract.json").read_text(encoding="utf-8"))
    section = merge_sections(extract, [str(s) for s in case["sections"]], case.get("title"))
    section["blocks"] = clip(section["blocks"], (case.get("clip") or {}).get("max_tokens"))
    objs = [Block(**b) for b in section["blocks"]]
    section["features"] = chunk_features(objs, Counter(), 1)

    out = OUT / case["id"]
    if (out / "files").exists():
        shutil.rmtree(out / "files")
    (out / "files").mkdir(parents=True, exist_ok=True)
    files: dict[str, str] = {}
    for b in section["blocks"]:
        name = b["meta"].get("saved_as")
        if b["kind"] == "code" and name:
            text = (chapter / "files" / name).read_text(encoding="utf-8").rstrip("\n")
            files[name] = text
            (out / "files" / name).write_text(text + "\n", encoding="utf-8")

    prompt = writer_prompt(section, files, case.get("shell", "basic"), case["brief"])
    source = {"book": case["book"], "chapter": extract.get("chapter"), "title": section["title"], "sections": [section]}
    (out / "source.json").write_text(json.dumps(source, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "prompt.json").write_text(json.dumps(prompt, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "prompt.md").write_text(f"<!-- system ({prompt['meta']['system_tokens_est']} tokens est., sha {prompt['meta']['system_sha']}) -->\n\n"
                                   f"{prompt['system']}\n\n<!-- user ({prompt['meta']['user_tokens_est']} tokens est.) -->\n\n{prompt['user']}",
                                   encoding="utf-8")
    shutil.copy(case_path, out / "case.yaml")
    kinds = Counter(b["kind"] for b in section["blocks"])
    return {"id": case["id"], "out": out, "blocks": len(section["blocks"]), "kinds": dict(kinds), "files": list(files),
            "source_tokens": sum(est_tokens(render_block(o)) for o in objs), **prompt["meta"]}


def main(argv: list[str]) -> int:
    wanted = set(argv)
    rows = []
    for p in sorted(CASES.glob("*.yaml")):
        if wanted and p.stem not in wanted:
            continue
        rows.append(prepare(p))
    print(f"{'case':24} {'blocks':>6} {'source tok':>10} {'user tok':>9} {'system tok':>10}  files")
    for r in rows:
        print(f"{r['id']:24} {r['blocks']:6d} {r['source_tokens']:10d} {r['user_tokens_est']:9d} {r['system_tokens_est']:10d}  {', '.join(r['files']) or '-'}")
    if rows:
        print(f"system prompt sha {rows[0]['system_sha']} (identical for every case: the cached prefix)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
