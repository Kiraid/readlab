"""Assemble the writer prompt exactly as the harness sends it.

system = writer role + FORMAT.md + pattern skills + widget catalog     (stable: identical for every section,
                                                                       so it is the cached prefix)
user   = section header + source text + files + shell + brief + output reminder   (varies per section)

The pieces are concatenated in a fixed order and the version hash of the system part is recorded, so a
change to any skill or widget shows up as a new prefix (and a cache miss) in the ledger.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from pipeline.ingest.config import ROOT

SKILLS = ROOT / "pipeline" / "skills"
WIDGETS = ROOT / "engine" / "widgets"
SHELLS = ROOT / "engine" / "shells"
SYSTEM_INTRO = ROOT / "pipeline" / "prompts" / "writer_system.md"


def est_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def schema_fields(schema: dict) -> str:
    """'title ≤120, lanes*: [{id* ≤20, label ≤28}], ...': the fields with their limits, one level into lists of
    objects. The checker enforces these, so a writer that never sees them overshoots and pays a fix round."""
    def one(name: str, s: dict, required: list) -> str:
        out = name + ("*" if name in required else "")
        if s.get("maxLength"):
            out += f" ≤{s['maxLength']}"
        item = s.get("items") or {}
        if s.get("type") == "array" and item.get("type") == "object" and item.get("properties"):
            inner = ", ".join(one(k, v, item.get("required", [])) for k, v in item["properties"].items())
            out += f": [{{{inner}}}" + (f", ≤{s['maxItems']} items" if s.get("maxItems") else "") + "]"
        elif s.get("type") == "object" and s.get("properties"):  # x: {label* ≤40, min, max*}
            out += ": {" + ", ".join(one(k, v, s.get("required", [])) for k, v in s["properties"].items()) + "}"
        return out
    return ", ".join(one(k, v, schema.get("required", [])) for k, v in schema.get("properties", {}).items())


def system_prompt() -> str:
    parts = [SYSTEM_INTRO.read_text(encoding="utf-8").strip(), "", "# Format guide", "",
             (SKILLS / "FORMAT.md").read_text(encoding="utf-8").strip(), "", "# Pattern skills", ""]
    for f in sorted(SKILLS.glob("*.md")):
        if f.name in ("FORMAT.md", "README.md"):
            continue
        parts += [f.read_text(encoding="utf-8").strip(), ""]
    parts += ["# Widget catalog", "",
              "Each widget: when to use it, its config, an example. Configs are checked against a schema; "
              "unknown fields are errors.", ""]
    for d in sorted(p for p in WIDGETS.iterdir() if (p / "skill.md").exists()):
        schema = json.loads((d / "schema.json").read_text(encoding="utf-8"))
        parts += [(d / "skill.md").read_text(encoding="utf-8").strip(),
                  f"\nConfig fields (* = required, ≤N = max characters): {schema_fields(schema)}", ""]
    return "\n".join(parts).strip() + "\n"


def shell_note(plugin: str) -> str:
    manifest = json.loads((SHELLS / plugin / "manifest.json").read_text(encoding="utf-8"))
    handles = manifest.get("handles", [])
    if plugin == "basic":
        return ("The page uses the `basic` shell: it only simulates builtins (" + ", ".join(handles) + "). "
                "For every other command in a :::term block, give the output the source shows after the `$` line.")
    return (f"The page uses the `{plugin}` shell plugin, which simulates these commands itself: {', '.join(handles)}. "
            "Do not write output for them (the simulator answers and keeps state). Give output only for other commands.")


def render_source(blocks: list[dict]) -> str:
    """The clipped source as readable Markdown (the same rendering ingestion writes to sections/*.md)."""
    from pipeline.ingest.blocks import Block
    from pipeline.ingest.sections import render_block

    out = []
    for b in blocks:
        out.append(render_block(Block(**b)))
    return "\n\n".join(out)


def user_prompt(section: dict, files: dict[str, str], shell: str, brief: str) -> str:
    pages = section.get("pages_label") or ""
    lines = [f"# Section to write: {section['id']} {section['title']}", "",
             f"Front matter: id \"{section['id']}\", title \"{section['title']}\"" + (f", pages {pages}" if pages else ""), "",
             "## Source text", "",
             "Extracted from the source document. It is for your understanding: explain it in your own words.",
             "Figures appear only as [Figure N: caption]; design your own diagrams of the same ideas.", "",
             "<source>", render_source(section["blocks"]), "</source>", ""]
    lines += ["## Chapter files", ""]
    if files:
        lines.append("Use these with `:::code src=NAME` (line numbers below start at 1).")
        for name, text in files.items():
            numbered = "\n".join(f"{i + 1:3d}  {l}" for i, l in enumerate(text.split("\n")))
            lines += ["", f"### {name}", "```", numbered, "```"]
    else:
        lines.append("(none)")
    lines += ["", "## Shell", "", shell_note(shell), "", "## Brief", "", brief.strip(), "",
              "## Output", "", "Return only the section file: the `---` front matter, then the body. Nothing before or after it."]
    return "\n".join(lines) + "\n"


def writer_prompt(section: dict, files: dict[str, str], shell: str, brief: str) -> dict:
    system = system_prompt()
    user = user_prompt(section, files, shell, brief)
    return {
        "system": system,
        "user": user,
        "meta": {
            "system_sha": hashlib.sha256(system.encode()).hexdigest()[:12],
            "system_tokens_est": est_tokens(system),
            "user_tokens_est": est_tokens(user),
        },
    }


# ---------------------------------------------------------------- digest, plan, judge
PROMPTS = ROOT / "pipeline" / "prompts"


def digest_prompt(chunk: dict) -> dict:
    """One call per chunk. The system part is identical for every chunk (cached); the user part is the chunk."""
    f = chunk.get("features", {})
    facts = {
        "listings": [l.get("file") or f"listing {l.get('listing')}" for l in f.get("listings", [])],
        "commands": [c["cmd"] for c in f.get("commands", [])][:20],
        "figures": [x.get("figure") for x in f.get("figures", [])],
        "callouts": f.get("callouts", {}),
        "key_terms": f.get("key_terms", [])[:15],
    }
    user = "\n".join([
        f"# Chunk {chunk['id']}: sections {', '.join(chunk['sections'])}", "",
        "Counted by code (exact): " + json.dumps(facts, ensure_ascii=False), "",
        "<source>", render_source(chunk["blocks"]), "</source>", "",
        "Return the digest JSON for this chunk.",
    ])
    return {"system": (PROMPTS / "digest_system.md").read_text(encoding="utf-8"), "user": user}


DEFAULT_READER = ("No reader notes. Assume a working software engineer who knows programming and the everyday tools of "
                  "the trade, but not this chapter's topic.")


def plan_prompt(chapter: dict, chunks: list[dict], digests: dict, reader: str | None = None) -> dict:
    """One call per chapter: the reader, the outline and every chunk's digest and counts. Never the source text."""
    parts = [f"# Chapter {chapter['id']}: {chapter['title']}", "", "## The reader", "", (reader or "").strip() or DEFAULT_READER,
             "", "## Outline", ""]
    parts += [f"- {s['id']} {s['title']}" for s in chapter["sections"]]
    parts += ["", "## Chunks", ""]
    for c in chunks:
        f = c.get("features", {})
        counts = {"prose_words": c.get("prose_words"), "listings": [l.get("file") for l in f.get("listings", [])],
                  "commands": len(f.get("commands", [])), "tables": c.get("tables", 0), "figures": len(f.get("figures", [])),
                  "callouts": f.get("callouts", {})}
        parts += [f"### {c['id']} (sections {', '.join(c['sections'])}: {c['title']})",
                  "counts: " + json.dumps(counts, ensure_ascii=False),
                  "digest: " + json.dumps(digests.get(c["id"], {}), ensure_ascii=False), ""]
    parts.append(f"Return the plan JSON with one entry for each of these chunks: {', '.join(c['id'] for c in chunks)}.")
    return {"system": (PROMPTS / "planner_system.md").read_text(encoding="utf-8"), "user": "\n".join(parts)}


def judge_prompt(section: dict, brief: str, written: str, findings: list[str]) -> dict:
    rubric = (ROOT / "evals" / "rubric.md").read_text(encoding="utf-8")
    rubric = rubric.split("\n", 1)[1] if rubric.startswith("#") else rubric  # drop the file's own title
    system = (PROMPTS / "judge_system.md").read_text(encoding="utf-8").replace("{{rubric}}", rubric.strip())
    user = "\n".join([
        f"# Section {section['id']}: {section['title']}", "",
        "## Source text", "", "<source>", render_source(section["blocks"]), "</source>", "",
        "## Brief", "", brief.strip(), "",
        "## Checker findings", "", "\n".join(findings) or "(none)", "",
        "## Section file", "", "<section>", written.strip(), "</section>", "",
        "Return the judgement JSON.",
    ])
    return {"system": system, "user": user}
