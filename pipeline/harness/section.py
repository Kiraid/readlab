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
- For a command that names a file not in files/: edit only that command line (point it at a file that is in
  files/, or drop that one line). Keep the terminal and its other commands.
- A problem with a line number points at that line of your draft (the YAML error quotes the failing line).
- Never delete a block, visual or paragraph just to make a problem go away.
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
    # --write-fixed: the validator's safe fixes are written back, so the kept file is the one that was scored
    p = subprocess.run(["node", str(ROOT / "tools" / "eval-score.mjs"), state["case_dir"], str(final), "--write-fixed"],
                       capture_output=True, text=True, cwd=ROOT)
    score_file = final.with_name(f"{state['run']}.score.json")
    if not score_file.exists():
        raise RuntimeError(f"scorer failed: {p.stderr[-600:]}")
    score = json.loads(score_file.read_text(encoding="utf-8"))
    hist = state["history"] + [{"node": "validate", "pass": score["pass"], "score": score["score"],
                                "errors": [i for i in score["issues"] if i.startswith(("error", "build"))]}]
    return {"score": score, "history": hist, "draft": final.read_text(encoding="utf-8")}


def route(state: State) -> str:
    if state["score"]["pass"] or state.get("fixes", 0) >= state.get("max_fix", 2):
        return "done"
    return "fix"


def _sentences(text: str) -> list[str]:
    body = re.sub(r"^---[\s\S]*?\n---\n", "", text)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n{2,}", body) if s.strip()]


def _norm_words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", s.lower().replace("’", "").replace("'", ""))


def _source_text(case_dir: str) -> str:
    try:
        sec = json.loads((Path(case_dir) / "source.json").read_text(encoding="utf-8"))["sections"][0]
    except (OSError, ValueError, KeyError, IndexError):
        return ""
    return "\n".join(str(b.get("text", "")) for b in sec.get("blocks", []))


def shared_phrase(sentence: str, source_text: str, n: int = 8) -> str | None:
    """The longest run of n+ words this sentence shares with the source. Told only "rewrite this sentence", the
    fixer often rephrased around the copied phrase and kept it (2026-11-07 runs: every copy failure left after two
    rounds); naming the exact words makes it change them."""
    w = _norm_words(sentence)
    src = f" {' '.join(_norm_words(source_text))} "
    best = None
    for i in range(len(w)):
        for j in range(len(w), i + n - 1, -1):
            if (best is None or j - i > len(best)) and f" {' '.join(w[i:j])} " in src:
                best = w[i:j]
                break
    return " ".join(best) if best else None


def describe_errors(score: dict, draft: str, source_text: str = "") -> list[str]:
    """Turn checker messages into instructions. Copy errors carry only a 6-word preview, so find the writer's
    own sentence that contains those words, quote it back, and name the words it shares with the source."""
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
            phrase = shared_phrase(hit, source_text) if hit and source_text else None
            out.append((f"- Copied run: this sentence of yours follows the source too closely; rewrite it: «{hit}»"
                        + (f"\n  The words the source has too, in this order: \"{phrase}\". Change that wording itself "
                           "(other words, another order or construction); rephrasing around it keeps the copy." if phrase else ""))
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
    problems = describe_errors(state["score"], state["draft"], _source_text(state["case_dir"]))
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


CORRECT_INSTRUCTIONS = """## Correct your section

A reviewer checked your section against the source and found the errors listed below (a wrong statement, a quiz
whose marked answer is wrong, an example whose numbers don't work, a visual that shows something false). Correct
each one, and nothing else: keep every other sentence, block and visual as it is.

Reply with JSON only, in this shape:
{"edits": [{"find": "<exact text copied from your section>", "replace": "<the corrected text>"}]}

- `find` must be an exact, unique substring of your section; for a quiz or a widget, replace the whole block.
- When you change an example, redo its arithmetic and check every place in the section that uses its numbers
  (the prose, the diagram, the quiz) and correct those too.
- A quiz keeps exactly one `+` option, and it must be the right answer.
- The source is the authority. If the reviewer is wrong about the source, leave that part unchanged.
"""


def correct(state: State, errors: list[dict]) -> State:
    """One correction round from the judge's error list, the same edit mechanics as fix(). Uses the `correct` node
    (it thinks: a wrong worked example needs its arithmetic redone), or `fix` for jobs configured before it existed."""
    problems = [f"- {e.get('where', '').strip()}: {e.get('problem', '').strip()}" + (f" Correction: {e['fix'].strip()}" if e.get("fix") else "")
                for e in errors]
    user = (f"{state['user']}\n\n{CORRECT_INSTRUCTIONS}\n## Your section\n\n<draft>\n{state['draft']}</draft>\n\n"
            "## Errors the reviewer found\n\n" + "\n".join(problems))
    res = _llm(state, "correct" if "correct" in state["nodes"] else "fix", user, json_mode=True)
    draft, applied, failed = apply_edits(state["draft"], res.text)
    hist = state.get("history", []) + [{"node": "correct", "errors": len(errors), "edits_applied": applied, "edits_failed": failed, "cost": res.cost_usd}]
    out: State = {"history": hist, "cost_usd": state.get("cost_usd", 0) + res.cost_usd}
    if applied:
        version = state.get("version", 0) + 1
        _save({**state, "version": version}, draft)
        out.update({"draft": draft, "version": version})
    return out


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
