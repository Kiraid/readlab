# Skills

A skill is a short recipe for one teaching pattern: when to use it, how to build it from the format's
blocks, a small example written for this repo, and a checklist. Writers load all of them (they are
stable text, so they sit in the cached prompt prefix); the planner names the ones each section should
use in its brief.

| File | Pattern | Built from |
|---|---|---|
| `FORMAT.md` | the writer contract: blocks, diagram DSL, terminals, YAML traps | — |
| `faithful-coverage.md` | cover everything in the author's order and depth, nothing added, in your own sentences | prose |
| `explain-listing.md` | a listing, then what each highlighted line does | `code` + prose |
| `terminal-walkthrough.md` | commands to try and what to look for in the output | `term` + prose |
| `clarify-misconception.md` | the one sentence that fixes what people get wrong | prose / `callout` |
| `process-stepper.md` | a loop or procedure as numbered steps on a diagram | `diagram flow` + `steps` |
| `request-path.md` | how a request/packet/message travels | `diagram flow` + `journeys`, `diagram sequence` |
| `diagram-brief.md` | a brief precise enough for a fresh-context diagram agent | brief → `diagram` |
| `quiz.md` | questions that test understanding | `quiz` |
| `recap-and-callouts.md` | notes, warnings, sidebars, tables, recaps | `callout`, tables, `recap` |
| `os-process-lifecycle.md` | process/thread states and what moves them | `state-machine`, `process-stepper` |
| `os-cpu-scheduling.md` | scheduling algorithms side by side | `timeline`, `compare-scale` |
| `sql-query-plan.md` | reading a query plan bottom-up; when an index is used | `diagram flow` + `steps`, `condition-checker` |
| `sql-transactions.md` | interleavings, anomalies and isolation levels | `timeline`, `matrix-explorer` |
| `data-structure-walk.md` | a lookup/insert through a tree, hash table or list | `diagram flow` + `steps` |

Widget skills live next to their widget: `engine/widgets/<name>/skill.md`.
