# Evals

Each case is a clipped piece of a real book chapter plus a brief, written once and re-run against every
pipeline version (prompt, model, format change). The cases test the **writer**: given the cached prefix
(format, skills, widget catalog) and one source snippet, does it produce a section that is faithful, builds,
and looks and works well?

These are quality evals, not behaviour evals. There is no single right answer: a timeline or a stepper can
both be good choices for the same snippet. So scoring has three layers:

| Layer | What | Who | Effect |
|---|---|---|---|
| **must** | builds with no format errors; no copied runs; every source listing shown; commands name real files | `tools/eval-score.mjs` (validator + builder) | a failure is a failed case |
| **should** | key-term coverage, prose length vs source, at least one visual, at least one quiz, uses the interactive pieces the snippet invites | `tools/eval-score.mjs` | a 0–100 score, compared between runs |
| **judge** | faithful, clear, visually good, interactivity that fits, polished | `evals/rubric.md`, read by a model judge or by you, with the built page | 1–5 per criterion; pairwise against goldens later |

`ideas` in a case are examples of good choices, shown to the judge as inspiration, never required.

## Layout

```
evals/cases/<id>.yaml       the case: book, chapter, sections, clip, brief, expectations, ideas
evals/prepare.py            builds the writer prompt exactly as the harness will send it
evals/rubric.md             the judge rubric
tools/eval-score.mjs        validates and builds one output, writes score.json
sources/evals/<id>/         (gitignored: contains book text) source.json, files/, prompt.json, prompt.md, outputs
```

## Run

```bash
./run.sh python -m evals.prepare                 # all cases -> sources/evals/<id>/prompt.{json,md}
# give prompt.json's system + user to a model (API, or a Claude Code subagent for $0 dry runs);
# save its reply as sources/evals/<id>/out/<run>.md
node tools/eval-score.mjs sources/evals/<id> sources/evals/<id>/out/<run>.md
```
