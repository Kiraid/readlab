"""Deterministic features per chunk: what the LLM digest would otherwise have to find.

Everything here is regex and counting, so it costs nothing and never hallucinates.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from pathlib import PurePosixPath

import yaml

from .blocks import Block

CODE_SPAN = re.compile(r"`([^`\n]+)`")
ITALIC = re.compile(r"(?<![*\w])\*([^*]+)\*(?![*\w])")
CAMEL = re.compile(r"\b[A-Z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]*)+\b")
CAPWORD = re.compile(r"\b[A-Z][a-z]{2,}\b")
IP = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
HOST = re.compile(r"\b(?:[a-z0-9-]+\.)+(?:com|io|org|net|dev|local|internal)\b")
PORT = re.compile(r"\bports?\s+`?(\d{2,5})\b", re.I)
FILE_EXT = re.compile(r"[\w.-]+\.(?:ya?ml|json|sh|conf|txt|py|js|ts|go|java|toml|ini|properties|xml|sql)$")
STOP = {"The", "This", "That", "These", "Those", "When", "What", "Which", "You", "Your", "If", "In", "It", "For",
        "Note", "See", "Figure", "Listing", "Table", "Chapter", "Section", "However", "And", "But", "As", "To",
        "With", "Once", "Then", "Because", "Also", "Instead", "Let", "Now", "First", "Next", "Finally", "After"}

PROSE = {"para", "item", "callout", "subheading"}


def prose_text(blocks: list[Block]) -> str:
    return "\n".join(b.text for b in blocks if b.kind in PROSE)


def term_candidates(text: str) -> Counter:
    """Inline code, italic terms, CamelCase words, and capitalised words that aren't sentence starts."""
    c: Counter = Counter()
    for m in CODE_SPAN.finditer(text):
        c[m.group(1).strip()] += 1
    for m in ITALIC.finditer(text):
        c[m.group(1).strip()] += 2  # italics usually mark a term being introduced
    plain = CODE_SPAN.sub(" ", text)
    for m in CAMEL.finditer(plain):
        c[m.group(0)] += 1
    for sent in re.split(r"(?<=[.!?:])\s+|\n", plain):
        for k, m in enumerate(CAPWORD.finditer(sent)):
            if m.start() == 0 or m.group(0) in STOP:
                continue
            c[m.group(0)] += 1
    return c


def commands(blocks: list[Block]) -> list[dict]:
    """`$ command` lines in code blocks, with how many output lines follow each one."""
    out = []
    for b in blocks:
        if b.kind != "code":
            continue
        cur = None
        for line in b.text.split("\n"):
            s = line.strip()
            if s.startswith("$ "):
                cur = {"cmd": s[2:].strip(), "output_lines": 0}
                out.append(cur)
            elif cur is not None and cur["cmd"].endswith("\\"):
                cur["cmd"] = cur["cmd"][:-1].rstrip() + " " + s
            elif cur is not None and s:
                cur["output_lines"] += 1
    return out


def listing_file(blocks: list[Block], idx: int) -> str | None:
    """A file name mentioned (as inline code) in the two prose blocks before a listing."""
    seen = 0
    for j in range(idx - 1, -1, -1):
        b = blocks[j]
        if b.kind in PROSE:
            for m in reversed(CODE_SPAN.findall(b.text)):
                if FILE_EXT.search(m.strip()):
                    return PurePosixPath(m.strip()).name
            seen += 1
            if seen == 2:
                break
    return None


ELLIPSIS = re.compile(r"^\s*(\.\.\.|…)\s*$")


def is_excerpt(text: str) -> bool:
    """Books shorten long manifests with a lone '...' line."""
    return any(ELLIPSIS.match(l) for l in text.splitlines())


def yaml_summary(text: str) -> list[dict]:
    text = "\n".join(l for l in text.splitlines() if not ELLIPSIS.match(l))
    try:
        docs = [d for d in yaml.safe_load_all(text) if isinstance(d, dict)]
    except yaml.YAMLError:
        return []
    return [{"kind": d.get("kind"), "apiVersion": d.get("apiVersion"),
             "name": (d.get("metadata") or {}).get("name")} for d in docs if d.get("kind")]


def annotate_listings(blocks: list[Block]) -> None:
    for i, b in enumerate(blocks):
        if b.kind == "code" and b.meta.get("listing"):
            b.meta["file"] = listing_file(blocks, i)
            b.meta["yaml"] = yaml_summary(b.text)
            b.meta["excerpt"] = is_excerpt(b.text)


def chunk_features(blocks: list[Block], df: Counter, n_chunks: int) -> dict:
    text = prose_text(blocks)
    cands = term_candidates(text)
    scored = sorted(((tf * math.log(1 + n_chunks / max(1, df[t])), t) for t, tf in cands.items() if len(t) > 1),
                    reverse=True)
    code_chars = sum(len(b.text) for b in blocks if b.kind == "code")
    all_chars = sum(len(b.text) for b in blocks) or 1
    listings = [{"listing": b.meta["listing"], "file": b.meta.get("file"), "lines": b.text.count("\n") + 1,
                 "annotations": len(b.meta.get("annotations", [])), "highlighted_lines": b.meta.get("bold_lines", []),
                 "yaml": b.meta.get("yaml", []), "excerpt": b.meta.get("excerpt", False)}
                for b in blocks if b.kind == "code" and b.meta.get("listing")]
    plain = CODE_SPAN.sub(lambda m: " " + m.group(1) + " ", text)
    return {
        "key_terms": [t for _, t in scored[:20]],
        "introduced_terms": sorted({m.group(1).strip() for m in ITALIC.finditer(text)}),
        "inline_code": sorted({m.group(1).strip() for m in CODE_SPAN.finditer(text)}),
        "commands": commands(blocks),
        "listings": listings,
        "figures": [{"figure": b.meta.get("number"), "caption": b.text} for b in blocks if b.kind == "figure"],
        "callouts": dict(Counter(b.meta.get("label") for b in blocks if b.kind == "callout")),
        "ips": sorted(set(IP.findall(plain))),
        "hosts": sorted(set(HOST.findall(plain))),
        "ports": sorted(set(PORT.findall(plain)), key=int),
        "code_ratio": round(code_chars / all_chars, 3),
    }


def difficulty(chunks: list[dict]) -> None:
    """Relative difficulty within the chapter (0-1) and a tier used later to route sections to models.
    A heuristic to calibrate against judge scores, not a truth."""
    def mx(key):
        return max((key(c) for c in chunks), default=1) or 1
    t_max = mx(lambda c: c["est_tokens"])
    k_max = mx(lambda c: len(c["features"]["key_terms"]) + len(c["features"]["introduced_terms"]))
    a_max = mx(lambda c: len(c["features"]["listings"]) + len(c["features"]["commands"]))
    for c in chunks:
        f = c["features"]
        score = (0.35 * c["est_tokens"] / t_max
                 + 0.25 * min(1.0, f["code_ratio"] * 2)
                 + 0.20 * (len(f["key_terms"]) + len(f["introduced_terms"])) / k_max
                 + 0.20 * (len(f["listings"]) + len(f["commands"])) / a_max)
        c["difficulty"] = round(score, 3)
        c["tier"] = "easy" if score < 0.4 else "medium" if score < 0.65 else "hard"
