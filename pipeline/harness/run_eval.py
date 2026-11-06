"""Run eval cases through the harness and report quality and cost.

  ./run.sh python -m pipeline.harness.run_eval [case ...] --run ds-1 [--model deepseek-flash] [--no-thinking]
                                              [--replay opus-2] [--no-cache] [--max-fix 2] [--budget 2.0]

Each case: the prompt from sources/evals/<case>/prompt.json (re-run `python -m evals.prepare` after changing
skills or the format) goes through write -> validate -> fix (pipeline/harness/section.py). Calls and their cost
go to runs/<run>/ledger.jsonl; the summary to runs/<run>/report.md and report.json (no book text in either).

--replay NAME uses an existing output (sources/evals/<case>/out/NAME.md) as the writer's reply, so the whole
graph can be exercised without an API key; fix calls then return no edits.
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pipeline.ingest.config import ROOT
from pipeline.llm import load_config
from pipeline.llm import core as llm_core
from pipeline.harness.section import build_graph

CASES = ROOT / "sources" / "evals"
RUNS = ROOT / "runs"


def ledger_total(path: Path) -> float:
    if not path.exists():
        return 0.0
    return sum(r.get("cost_usd", 0) for r in llm_core.read_ledger(path))


def run_case(case: str, args, nodes: dict, ledger: Path) -> dict:
    case_dir = CASES / case
    prompt = json.loads((case_dir / "prompt.json").read_text(encoding="utf-8"))
    graph = build_graph()
    final = graph.invoke({"case_dir": str(case_dir), "run": args.run, "tag": case, "system": prompt["system"],
                          "user": prompt["user"], "nodes": nodes, "max_fix": args.max_fix, "ledger": str(ledger)},
                         {"recursion_limit": 4 + 3 * args.max_fix})
    s = final["score"]
    rows = [r for r in llm_core.read_ledger(ledger) if r.get("tag") == case]
    return {
        "case": case, "pass": s["pass"], "score": s["score"], "fixes": final.get("fixes", 0),
        "must": s["must"], "words": s["metrics"].get("words"), "source_words": s["metrics"].get("source_words"),
        "coverage": s["metrics"].get("coverage"), "copy_errors": sum(1 for i in s["issues"] if "[copy]" in i),
        "calls": len(rows), "tokens_in": sum(r["input"] for r in rows), "cache_hit": sum(r["cache_hit"] for r in rows),
        "tokens_out": sum(r["output"] for r in rows), "reasoning": sum(r["reasoning"] for r in rows),
        "cost_usd": round(sum(r["cost_usd"] for r in rows), 5), "latency_s": round(sum(r["latency_s"] for r in rows), 1),
        "history": final.get("history", []),
    }


def report_md(run: str, rows: list[dict], nodes: dict) -> str:
    lines = [f"# Eval run {run}", "", f"write: `{nodes['write']['provider']}/{nodes['write']['model']}` thinking={nodes['write'].get('thinking')}  ·  "
             f"fix: `{nodes['fix']['provider']}/{nodes['fix']['model']}` thinking={nodes['fix'].get('thinking')}", "",
             "| case | pass | score | fixes | words/source | coverage | copy errors | calls | in (cache hit) | out (reasoning) | $ | s |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if "error" in r:
            lines.append(f"| {r['case']} | error | | | | | | | | | | |")
            continue
        lines.append(f"| {r['case']} | {'✓' if r['pass'] else '✗'} | {r['score']} | {r['fixes']} | {r['words']}/{r['source_words']} | "
                     f"{r['coverage']}% | {r['copy_errors']} | {r['calls']} | {r['tokens_in']} ({r['cache_hit']}) | "
                     f"{r['tokens_out']} ({r['reasoning']}) | {r['cost_usd']:.4f} | {r['latency_s']} |")
    ok = [r for r in rows if "error" not in r]
    if ok:
        lines += ["", f"**Total:** {sum(r['pass'] for r in ok)}/{len(ok)} pass · ${sum(r['cost_usd'] for r in ok):.4f} · "
                      f"{sum(r['tokens_out'] for r in ok)} output tokens"]
    errs = [r for r in rows if "error" in r]
    if errs:
        lines += ["", "## Errors", ""] + [f"- {r['case']}: {r['error']}" for r in errs]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.harness.run_eval")
    ap.add_argument("cases", nargs="*")
    ap.add_argument("--run", required=True, help="run name, e.g. ds-1 (outputs: out/<run>.md, runs/<run>/)")
    ap.add_argument("--model", help="writer and fixer model, e.g. deepseek-flash or deepseek-v4-pro")
    ap.add_argument("--no-thinking", action="store_true", help="turn reasoning off for the writer")
    ap.add_argument("--replay", help="use sources/evals/<case>/out/<NAME>.md as the writer's reply (no API)")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--max-fix", type=int)
    ap.add_argument("--budget", type=float)
    ap.add_argument("--parallel", type=int, default=5)
    args = ap.parse_args(argv)

    cfg = load_config()
    nodes = {k: dict(v) for k, v in cfg["nodes"].items()}
    args.max_fix = args.max_fix if args.max_fix is not None else cfg["run"]["max_fix_rounds"]
    budget = args.budget if args.budget is not None else cfg["run"]["budget_usd"]
    if args.model:
        for n in nodes.values():
            n["model"] = args.model
    if args.no_thinking:
        nodes["write"]["thinking"] = False
    if args.replay:
        for n in nodes.values():
            n["provider"] = "replay"
        llm_core.REPLAY["write"] = lambda c: (CASES / c.tag / "out" / f"{args.replay}.md").read_text(encoding="utf-8")
        llm_core.REPLAY["fix"] = lambda c: '{"edits": []}'
    if args.no_cache:
        llm_core.CACHE_DIR = ROOT / ".cache" / "llm-off"  # empty: every call goes to the provider

    cases = args.cases or sorted(p.name for p in CASES.iterdir() if (p / "prompt.json").exists())
    out = RUNS / args.run
    out.mkdir(parents=True, exist_ok=True)
    ledger = out / "ledger.jsonl"

    def one(case: str) -> dict:
        if ledger_total(ledger) >= budget:
            return {"case": case, "error": f"budget ${budget} reached"}
        try:
            return run_case(case, args, nodes, ledger)
        except Exception as e:  # noqa: BLE001 - report and keep the other cases going
            return {"case": case, "error": f"{type(e).__name__}: {e}"}

    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        rows = list(pool.map(one, cases))
    (out / "report.json").write_text(json.dumps({"run": args.run, "nodes": nodes, "cases": rows}, indent=2), encoding="utf-8")
    md = report_md(args.run, rows, nodes)
    (out / "report.md").write_text(md, encoding="utf-8")
    print(md)
    return 0 if all("error" not in r for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
