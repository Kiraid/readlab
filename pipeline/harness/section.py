"""One section through the harness, as a LangGraph graph:

    write ──► validate ──(must checks pass, or out of fix rounds)──► END
                 ▲   │
                 │   └──(errors)──► fix
                 └──────────────────┘

write     the writer prompt (system = cached toolkit prefix, user = source + brief) -> a section draft
validate  tools/eval-score.mjs: builds the page, runs the validator against the clipped source, scores it
fix       sends only the errors back and asks for find/replace edits as JSON (a few hundred tokens instead of
          a full rewrite); for a copy error it quotes the writer's own sentence so the model knows what to
          rewrite. Edits that don't apply fall back to one full rewrite.

Drafts land in <case>/out/<run>.v<N>.md and the final one in <case>/out/<run>.md, so every round is visible.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import TypedDict

from langgraph.graph import END, StateGraph

from pipeline.ingest.config import ROOT
from pipeline.llm import Call, call

FIX_INSTRUCTIONS = """## Fix your draft

Your previous draft is below, followed by the problems an automatic checker found. Fix exactly these problems
and nothing else: keep every other sentence, block and visual as it is.

Reply with JSON only, in this shape:
{"edits": [{"find": "<exact text copied from your draft>", "replace": "<the new text>"}]}

- `find` must be an exact, unique substring of your draft (a whole sentence is safest).
- For a copied run: rewrite that sentence in your own words with a different structure, keeping its meaning.
- For a format or widget error: replace the faulty block with a corrected one.
- For a missing listing: replace a nearby sentence with that sentence followed by the `:::code src=...` block.
"""


class State(TypedDict, total=False):
    case_dir: str
    run: str
    tag: str
    system: str
    user: str
    nodes: dict          # node configs from pipeline/config.yaml (write, fix)
    max_fix: int
    ledger: str
    draft: str
    version: int
    fixes: int
    score: dict
    history: list
    cost_usd: float


def _strip_fence(text: str) -> str:
    """Models sometimes wrap the whole answer in a code fence; the format forbids it."""
    m = re.match(r"^\s*```[a-z]*\n([\s\S]*?)\n```\s*$", text)
    return (m.group(1) if m else text).strip() + "\n"


def _save(state: State, text: str) -> Path:
    out = Path(state["case_dir"]) / "out"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{state['run']}.v{state.get('version', 0)}.md").write_text(text, encoding="utf-8")
    final = out / f"{state['run']}.md"
    final.write_text(text, encoding="utf-8")
    return final


def _llm(state: State, node: str, user: str, json_mode: bool = False):
    cfg = state["nodes"][node]
    res = call(Call(node=node, provider=cfg["provider"], model=cfg["model"], system=state["system"], user=user,
                    thinking=cfg.get("thinking", True), max_tokens=cfg.get("max_tokens", 8000), json_mode=json_mode,
                    tag=state.get("tag", "")), ledger=Path(state["ledger"]) if state.get("ledger") else None)
    return res


def write(state: State) -> State:
    res = _llm(state, "write", state["user"])
    draft = _strip_fence(res.text)
    _save({**state, "version": 0}, draft)
    hist = state.get("history", []) + [{"node": "write", "tokens_out": res.usage.output, "cost": res.cost_usd, "cached": res.cached}]
    return {"draft": draft, "version": 0, "fixes": 0, "history": hist, "cost_usd": state.get("cost_usd", 0) + res.cost_usd}


def validate(state: State) -> State:
    final = Path(state["case_dir"]) / "out" / f"{state['run']}.md"
    p = subprocess.run(["node", str(ROOT / "tools" / "eval-score.mjs"), state["case_dir"], str(final)],
                       capture_output=True, text=True, cwd=ROOT)
    score_file = final.with_name(f"{state['run']}.score.json")
    if not score_file.exists():
        raise RuntimeError(f"scorer failed: {p.stderr[-600:]}")
    score = json.loads(score_file.read_text(encoding="utf-8"))
    hist = state["history"] + [{"node": "validate", "pass": score["pass"], "score": score["score"],
                                "errors": [i for i in score["issues"] if i.startswith(("error", "build"))]}]
    return {"score": score, "history": hist}


def route(state: State) -> str:
    if state["score"]["pass"] or state.get("fixes", 0) >= state.get("max_fix", 2):
        return "done"
    return "fix"


def _sentences(text: str) -> list[str]:
    body = re.sub(r"^---[\s\S]*?\n---\n", "", text)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n{2,}", body) if s.strip()]


def _norm_words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", s.lower().replace("’", "").replace("'", ""))


def describe_errors(score: dict, draft: str) -> list[str]:
    """Turn checker messages into instructions. Copy errors carry only a 6-word preview, so find the writer's
    own sentence that contains those words and quote it back."""
    out = []
    sents = _sentences(draft)
    for issue in score["issues"]:
        if not issue.startswith(("error", "build")):
            continue
        m = re.search(r'\("([^"]+?)(?: …)?"\)', issue)
        if "[copy]" in issue and m:
            want = " ".join(_norm_words(m.group(1)))
            hit = next((s for s in sents if want in " ".join(_norm_words(s))), None)
            if not hit:  # the run crosses line breaks (a numbered list): try up to four consecutive lines
                lines = [l for l in re.sub(r"^---[\s\S]*?\n---\n", "", draft).split("\n") if l.strip()]
                hit = next((" / ".join(lines[i:i + n]) for n in (2, 3, 4) for i in range(len(lines) - n + 1)
                            if want in " ".join(_norm_words(" ".join(lines[i:i + n])))), None)
            out.append(f"- Copied run: this sentence of yours follows the source too closely; rewrite it: «{hit}»"
                       if hit else f"- {issue}")
        else:
            out.append(f"- {issue}")
    return out


def apply_edits(draft: str, raw: str) -> tuple[str, int, list[str]]:
    try:
        edits = json.loads(raw).get("edits", [])
    except (json.JSONDecodeError, AttributeError):
        return draft, 0, ["reply was not JSON"]
    applied, failed = 0, []
    for e in edits:
        f, r = e.get("find", ""), e.get("replace", "")
        if f and draft.count(f) == 1:
            draft = draft.replace(f, r)
            applied += 1
        else:
            failed.append((f[:60] + "…") if len(f) > 60 else f)
    return draft, applied, failed


def fix(state: State) -> State:
    problems = describe_errors(state["score"], state["draft"])
    user = f"{state['user']}\n\n{FIX_INSTRUCTIONS}\n## Your draft\n\n<draft>\n{state['draft']}</draft>\n\n## Problems\n\n" + "\n".join(problems)
    res = _llm(state, "fix", user, json_mode=True)
    draft, applied, failed = apply_edits(state["draft"], res.text)
    cost = res.cost_usd
    mode = "edits"
    if applied == 0:  # nothing applied: one full rewrite instead
        rewrite_user = (f"{state['user']}\n\n## Your previous draft\n\n<draft>\n{state['draft']}</draft>\n\n## Problems found\n\n"
                        + "\n".join(problems) + "\n\nReturn the whole corrected section file, changing only what these problems need.")
        res2 = _llm(state, "write", rewrite_user)
        draft, cost, mode = _strip_fence(res2.text), cost + res2.cost_usd, "rewrite"
    version = state.get("version", 0) + 1
    _save({**state, "version": version}, draft)
    hist = state["history"] + [{"node": "fix", "mode": mode, "edits_applied": applied, "edits_failed": failed, "cost": cost}]
    return {"draft": draft, "version": version, "fixes": state.get("fixes", 0) + 1, "history": hist,
            "cost_usd": state.get("cost_usd", 0) + cost}


def build_graph():
    g = StateGraph(State)
    g.add_node("write", write)
    g.add_node("validate", validate)
    g.add_node("fix", fix)
    g.set_entry_point("write")
    g.add_edge("write", "validate")
    g.add_conditional_edges("validate", route, {"fix": "fix", "done": END})
    g.add_edge("fix", "validate")
    return g.compile()
