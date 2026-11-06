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
        fields = ", ".join(f"{k}{'*' if k in schema.get('required', []) else ''}" for k in schema.get("properties", {}))
        parts += [(d / "skill.md").read_text(encoding="utf-8").strip(), f"\nConfig fields (* = required): {fields}", ""]
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
