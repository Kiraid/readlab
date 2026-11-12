# Interactive Technical Book: Step-by-Step Project Guide

> Written 2026-11-04 for review. Companion to `HANDOFF.md`, which has the background, the first run's numbers
> and the API facts. This guide is the **build order**: what to build, in which order, what needs an LLM API,
> and how each step keeps costs down without losing the quality of the Opus reference run (`reference/kia-ch12`).

---

## Where we are (2026-11-06)

### Done

| Piece | What exists | Where |
|---|---|---|
| Ingestion (step 1) | PDF → sections → chunks + features, no model; works on 4 differently typeset books (KiA, OSTEP, Database Internals, DDIA) | `pipeline/ingest/`, `books/*/book.yaml` |
| Format + builder (step 3a) | Markdown with `:::` blocks → one self-contained HTML page, line-numbered errors | `tools/build.mjs`, `tools/format/` |
| Diagram renderer (3b) | `flow` + `sequence` DSL; the renderer owns layout, labels, packets, steps | `tools/format/diagram.mjs`, `engine/js/diagram.js` |
| Engine (3c) | ported from ch13: terminal, core blocks, widget registry; shell plugins `basic`, `kubectl-ingress`, `kubectl-gateway` | `engine/` |
| Widget catalog (3d) | 8 global widgets, each with code, schema, example, skill | `engine/widgets/` |
| Skills (3e) | the writer contract (`FORMAT.md`) + 14 pattern skills incl. OS and SQL | `pipeline/skills/` |
| Validator (step 4) | copy, coverage, per-paragraph coverage, listings, files, numbers, inventory, length vs source; autofix | `tools/validate.mjs`, `tools/format/checks.mjs` |
| Eval set (step 5, part) | 5 cases from 4 books; prompt assembly exactly as the harness sends it; scorer; judge rubric | `evals/`, `pipeline/prompts/`, `tools/eval-score.mjs` |
| App (early) | FastAPI library API + chapter serving, React/TypeScript library, book and reader pages | `app/` |
| Harness, first slice | LangGraph per section: write → validate → fix (find/replace edits as JSON, fallback to one rewrite; copy errors quote the writer's own sentence); DeepSeek + replay providers, response cache, JSONL cost ledger with peak/off-peak pricing; eval runner with budget cap | `pipeline/harness/`, `pipeline/llm/`, `pipeline/config.yaml`, `.env` |

### First writer evals (Opus, one call per case, no tools, only the harness prompt)

| Case | Book | Must | Score | Used | Output tokens* | Est. $ at Opus prices |
|---|---|---|---|---|---|---|
| ostep-fifo-sjf | OSTEP | **pass** | 96 | 4 timelines, table, 3 callouts, 2 quizzes | 8.7k | ~0.22 |
| kia-create-service | KiA | copy ✗ (2 runs) | 94 | listing, stepper, 3 terminals, toggle-compare, 7 callouts, table | 20.7k | ~0.46 |
| ddia-read-committed | DDIA | copy ✗ (2 runs) | 96 | 2 timelines, toggle-compare, 4 callouts, 2 quizzes | 18.1k | ~0.40 |
| dbi-btree-lookup | DBI | copy ✗ (2 runs) | 90 | 2 diagrams (stepper), table, 2 quizzes | 26.6k | ~0.58 |
| dbi-btree-split | DBI | copy ✗ (2 runs) | 91 | 3 steppers, table, 2 quizzes | 29.2k | ~0.63 |

\* thinking included. Input per call ≈ 11k tokens, of which the ~9k system prompt is the cached prefix.

What the runs showed:
- **Everything builds and renders**: no console errors, no overlapping diagram text, no failed widgets, full
  key-term coverage on 4 of 5. Visual choices were sensible (timelines for schedules and transaction
  interleavings, steppers for tree walks and splits). No writer asked for a new widget (`evals/widget-requests.jsonl` stays empty).
- **The one real weakness is copying**: 4 of 5 sections kept two phrases of 8–12 words from the source
  (definitions, a procedure's steps, a figure description). The fix is a fix step that sends exactly those
  errors back for a rewrite (harness, below) and a stronger line in the writer prompt; re-measure after.
- **Toolkit fixes made from the runs**: headings exempt from the copy check; copied runs that are mostly names
  or numbers are a warning; autofix splits multi-question quiz blocks; visual widgets count as figures;
  timelines accept an `ok` role; format-guide lines on one question per quiz, catch-up only with stateful
  shells, and not numbering stepper steps by hand.
- **Checker blind spots seen**: close paraphrases under 8 words (e.g. the book's jokes) pass; the numbers check
  flags correct arithmetic when ingestion dropped a formula, and flags invented example keys (fine to show
  the judge).

### Second writer run: retell the author, nothing cut, nothing added (`opus-2`)

Changed before the run: the writer prompt and `faithful-coverage` now say the author's explanation is the
source of truth (every paragraph's point, example, number and caveat, in order, at the author's depth; no
summarising, no added background or "why it matters"; at most one clarification, only when the brief asks;
own sentences). Length is tied to the source instead of a brief's `Budget:` line: prose 85–115% of the
source's prose (validator `budget` warning, scorer `length`). New validator check `paragraph`: per source
paragraph, the weighted share of its distinctive tokens (numbers, code, names, rarer words) found in the
section; under 0.3 is a warning. The rubric's **faithful** now scores padding as hard as omission.

Both runs scored with the same (new) checker; run 1's original scores were 96 / 94 / 96 / 90 / 91.

| Case | Must (1 → 2) | Score (1 → 2) | Prose vs source, retelling only (all prose) | Key-term coverage | Paragraph warnings | Copy runs (error) |
|---|---|---|---|---|---|---|
| ostep-fifo-sjf | pass → **fail** | 95 → 98 | 68% → 99% (96% → 120%) | 88% → 100% | 0/18 → 0/18 | 0 → 1 |
| kia-create-service | fail → fail | 94 → 89 | 86% → 95% (105% → 102%) | 100% → 100% | 0/17 → 0/17 | 2 → 2 |
| ddia-read-committed | fail → fail | 99 → 97 | 90% → 90% (119% → 116%) | 100% → 100% | 0/6 → 1/6 | 2 → 1 |
| dbi-btree-lookup | fail → fail | 94 → 78 | 94% → 96% (124% → 119%) | 100% → 89% | 0/6 → 0/6 | 2 → 2 |
| dbi-btree-split | fail → fail | 93 → 100 | 87% → 101% (122% → 135%) | 75% → 75% | 1/5 → 0/5 | 2 → 2 |

What it showed:
- **The "padding" in run 1 was quizzes and recaps, not extra explanation.** Counting only the retelling,
  run 1 sat at 68–94% of the source (OSTEP had dropped about a third); run 2 sits at 90–101% in all five. So the
  length check now counts prose without `:::quiz` and `:::recap` (`metrics.retell_words`); `metrics.words` still
  has everything, and the copy check still covers quizzes and recaps.
- **Copying didn't move**: 4 cases still have two 8–10 word runs and OSTEP now has one (a workload's arrival
  times). A prompt line alone won't fix it; the harness fix node that sends the copy errors back for a rewrite is still needed.
- **Fewer visuals in two cases**: KiA used no widget (a diagram, terminals and callouts) and DBI lookup used one
  diagram where the case expects two, which is most of their score drop. Worth watching: "don't add" may be
  read as "don't add visuals".
- **Paragraph check**: one warning per run. The DDIA one is a false positive (that paragraph is retold; its
  distinctive tokens are everyday words plus a word split by a page break). It is a pointer for the judge, not
  a gate.
- Everything builds and renders (no console errors, no overlapping diagram labels, every widget drawn).
- Run 2 used the prompt from just before "(quizzes and recaps don't count)" was added to the length line;
  the prompts in `sources/evals/` were regenerated after.

### First harness run: DeepSeek flash (`ds-1`, 2026-11-06)

The real pipeline, not Claude Code: `python -m pipeline.harness.run_eval --run ds-1`. Writer `deepseek-flash`
with thinking, fixer `deepseek-flash` without; write → validate → fix (up to 2 rounds). Report and ledger in
`runs/ds-1/`.

| Case | Must | Score | Fix rounds | Retelling vs source | Coverage | Visuals | Out tokens (reasoning) | $ | s |
|---|---|---|---|---|---|---|---|---|---|
| ostep-fifo-sjf | pass | 98 | 2 | 96% | 100% | 4 timelines, 2 quizzes | 12.8k (9.8k) | 0.0105 | 74 |
| kia-create-service | pass | 89 | 1 | 89% | 100% | diagram, 3 terminals, 2 quizzes | 9.3k (6.6k) | 0.0096 | 54 |
| ddia-read-committed | pass | 99 | 1 | 85% | 100% | diagram, 2 timelines, 2 quizzes | 20.0k (17.9k) | 0.0144 | 98 |
| dbi-btree-lookup | pass* | 94 | 2 | 100% | 100% | 3 diagrams, toggle-compare, 3 quizzes | 17.0k (13.4k) | 0.0131 | 94 |
| dbi-btree-split | pass* | 95 | 2 | 87% | 75% | 3 diagrams, 2 quizzes | 27.0k (23.9k) | 0.0188 | 150 |

**Total: 5/5 pass, $0.066 for all five** (≈1.3¢ per section, vs ≈$0.2–0.6 per section at Opus prices).
\* These two failed at run time on a diagram whose YAML had `: ` inside a value; the builder now quotes such
values itself (`repairYaml` in `tools/format/render.mjs`), and both outputs pass unchanged under it.

What it showed:
- **The fix node works**: every copy error was rewritten (27 edits proposed, 27 applied, 0 failed); no case ends
  with a copied run. The copy problem the Opus runs had is solved by the loop, not the prompt.
- **Thinking is most of the output** (~80% of output tokens are reasoning). A thinking-off writer is an obvious
  ladder rung to measure.
- **Toolkit fixes from this run**: YAML values with `: ` are quoted automatically; the diagram renderer routes an
  edge round the side when a node sits between two nodes in the same column, and nudges edge labels until they
  clear nodes and other labels (no overlapping text on any eval page now).
- **Quality still unjudged**: scores are the automatic checks. Reading the pages next to the Opus ones (rubric) is next.

### What's left, in order

The old step numbers below (5–12) still describe each piece in detail; this is the order to do them in.

1. **Judge the outputs and pick goldens** (old 5 + 9): read `opus-2` and `ds-1` side by side with `evals/rubric.md`
   (you, or an Opus judge), note what the writer prompt or skills should change, and keep the best 2–3 sections
   as goldens (private when derived from a book).
2. **Model comparisons on the 5 cases** (old 8 + 10): `deepseek-v4-pro` (`--model deepseek-v4-pro`), flash with
   thinking off (`--no-thinking`), later Gemini; same cases, same checks, compare cost and quality.
3. **Finish the harness** (old 6 + 7). **Done 2026-11-07**: the chapter graph (`pipeline/harness/chapter.py`:
   ingest → digest × N → plan → per chunk write/validate/fix then judge → build → finalize), digest, planner and
   judge prompts, auto-calibrated ingestion for any uploaded PDF (fonts learnt from outline titles, captions and
   listing annotations; running heads; no-outline fallback), upload/job API with live status, app pages (Upload,
   job view, Pipeline diagram), and the build step (`pipeline/harness/page.py`): each run becomes one chapter page,
   listed in the Library under its upload. Dry-run mode runs the whole graph with stub replies.
   First real runs (KiA ch14, 2026-11-06/07): $0.12 for the chapter; after the ingest/checker fixes and the planner
   moved to flash, 12/13 sections pass, judge 4.2/5.
   **Cross-book test, 2026-11-07** (full chapters, run two at a time with fixes between sets): OSTEP Scheduling +
   Locks, Rust ch4 + ch16, Database Internals ch2 + ch5, DDIA ch5 + ch7. 89–100% of sections pass per chapter
   (after fixes), judge 4.0–4.4, $0.10–0.25 and 4–8 minutes a chapter. Fixed along the way: timeline playback after
   pause, label limits now shown to the writer, YAML repairs (flow maps, comma splits, quoted-then-text values),
   quoted program output allowed by the copy check, the fixer told the exact copied words, provider retries,
   planner/judge token limits (+ salvaging a cut-off plan), reference lists dropped at ingest, printed chapter
   numbers for unnumbered outlines. **Open:** DDIA's first drafts copy far more than other books (150–200 runs a
   chapter vs 20–70); a richer plan adds widgets without raising the judge's score (watch page density); one
   widget request so far (`growth-curves`: plot a metric while sliders change the inputs), built as `curve-explorer`.
   **Teaching redesign, 2026-11-12:** the planner designs the chapter for a reader (a probe on upload asks 3-4
   questions about the chapter; the answers become reader notes): goal, a running example, misconceptions to
   confront, layers to peel, 2-4 mechanisms worth an interactive build, and a role per section (mechanism, concept,
   system, procedure, argument, context) that decides its visuals; no visual quotas. Writers keep every point of
   the author's but may reorder and add labelled teaching (`:::callout example|analogy|underneath`, shown as not
   from the book, outside the 80-130% length band). First comparison (DDIA ch7, OSTEP ch7): all sections pass,
   visuals halved, decorative widgets gone; but the writer's own examples and quizzes carried 2 errors the judge
   caught. **Correction step (same day):** the judge now returns an `errors` list (wrong statements, wrong quiz keys,
   examples whose arithmetic fails, visuals that show something false); each section with errors gets one
   correction round (the `correct` node, thinking on), is re-checked (reverted if it breaks a passing section) and
   re-judged. On DDIA ch7: 6 errors in 4 sections corrected, both known ones included, 1 still flagged; about
   +$0.02 a chapter.
4. **Judge and calibration** (old 9): an LLM judge with the rubric, pairwise against goldens; you score a few to
   check it agrees.
5. **Claude baseline + ladder** (old 11): the "N× cheaper at equal quality" numbers (needs Anthropic credits).
6. **Public demo** (old 12): run on the kubernetes.io Ingress docs (CC BY 4.0), publish with the cost report.

Parallel track, **the app**: done so far is a read-only library. Later: uploads and jobs (queue + worker
calling the pipeline), auth, and serving chapter pages from their own origin.

Known gaps carried forward: ingestion quirks (OSTEP boxed asides and dropped formula fractions, KiA split
captions and duplicated continued tables); the two kubectl simulators are not merged; `needs=`/`sets=`
canned-command flags not implemented; non-PDF input (articles, Markdown, docs pages) needs an ingest adapter.

---

## 0. The short version

- **About 70% of this project needs no LLM API at all.** Ingestion, chunking, the page engine, the diagram
  renderer, widgets, validators, the copy check, the harness skeleton and the cost ledger are all ordinary code.
  Build those first, for $0.
- **Golden sections are hand-made with Claude Code** (your subscription, normal interactive use). They prove the
  format can match the reference, and they become few-shot examples and eval references.
- **First real LLM runs use DeepSeek** (a few dollars of credit goes a very long way) **or the Gemini free tier**
  (quick smoke tests; daily limits are small and change often, so check AI Studio).
- **Anthropic credits are only needed at the end**, for the v0 Opus baseline and the Claude rungs of the cost
  ladder. Estimated $30–50 for the whole experiment on one chapter (section 6).

The core rule behind every cost decision:

> **The LLM writes only what needs judgment: wording, choices, questions. Code does everything else:
> layout, rendering, numbering, file extraction, checking, fixing obvious mistakes, assembling.**

---

## 0.1 Review decisions (2026-11-06, after reading ch12 and ch13)

1. **Two references.** `reference/kia-ch12` and `reference/kia-ch13`. ch13 has the newer engine (sidebar HUD,
   six labs, `for` loops and `| grep` in the shell), so it is the base for the engine port.
2. **Content: faithful paraphrase, not the book's sentences.** Pages cover everything the book section covers,
   in its order, with its numbering, terms, listings, commands, tables and caveats (the ch13 `AUTHORING.md`
   policy). The prose is the writer's own, close to the book in structure, never pasted or lightly edited
   book sentences. Each section shows its book pages ("book pp. 392–395") so the original wording is one click
   away in the local PDF. Cost is not a reason to change this: a chapter's prose is roughly 10–15k output
   tokens, cents on a cheap writer. The first run was expensive because of hand-drawn SVG, render-and-look
   loops, Opus doing every step, and the orchestrator re-reading everything.
3. **The additions are the product.** What the review singled out: listing walkthroughs with line references,
   "what to look for" after commands, one-line clarifications of what people get wrong ("the proxy connects to
   pods, not the ClusterIP"), process loops as step-throughs ("what the controller does all day"), request
   paths with moving packets, the compare slider, the request playground. These become **skills** (below).
4. **Skills library.** `pipeline/skills/*.md`, one per pattern: when to use it, the recipe, a good example in
   our own words, a short checklist. The planner assigns skills per section; writers get the whole library in
   the cached prefix (it is stable, so it costs cache-read prices). Starting set: `explain-listing`,
   `terminal-walkthrough`, `clarify-misconception`, `process-stepper`, `request-path`, `compare-scale`,
   `playground`, `quiz`, `recap`, `diagram-brief`.
5. **The stateful shell stays.** It was the review's favourite part. Split it into:
   - the generic engine shell (chips, typing, Tab, history, catch-up, shared state, virtual files): written once;
   - a **tool plugin per command family**, written once and reused across books and chapters: `kubectl`
     (merge the ch12 and ch13 simulators into one resource store), later a coreutils/filesystem shell;
   - **real runtimes where they exist**, instead of simulating: Pyodide for Python books, sql.js or PGlite for
     SQL books;
   - per-chapter **data** written by the LLM: files, starting state, catch-up checkpoints per section, and
     extra canned commands (`pattern → output`, with `needs=`/`sets=` flags). The LLM never writes simulator JS.
6. **One global widget catalog** (decided 2026-11-06; expected size 10–20, maybe 30–40 after many
   books). Each widget is `engine/widgets/<name>/` with `widget.js`, `schema.json` (allowed config),
   `example.yaml` and `skill.md`. Widgets are generic and configured by data: no book-specific names in the
   JS. Pages include only the widgets they use. Writers never invent widgets during a run; when nothing
   fits they write a `:::widget-request` (`name`, `shows`, `inputs`, `fallback`). The page shows the
   fallback and the build writes `widget-requests.json`. Then, once per book:
   planner merges duplicates and checks the catalog → a **widget-builder agent** (fresh context: the request,
   the `WIDGETS.register` contract, two existing widgets, the palette) writes the four files on a branch
   `widgets/<name>` → scripts check them (schema validates the example, it renders in a headless browser with
   no console errors, fits 375px, uses palette classes only, no network or `eval`) → **you review and merge**
   → the sections that asked are rebuilt (everything else comes from the response cache).
   Shell simulators are separate: `engine/shells/<plugin>/`, one per command family.
7. **Light verification.** The orchestrator never reads section output. Scripts check instead: the validator,
   plus a headless smoke test (no console errors, every chip runs without "command not found", no overflow at
   375px, no overlapping SVG text). The judge scores samples and flagged sections only. It is a study book,
   not a production app.
8. **Single-file build.** The assembler inlines every section into one HTML file, so a page opens with a
   double-click (`file://` blocks the runtime `fetch()` the references use) and can be sent as one file.

---

## 1. The quality bar, and who produces each feature now

Every feature the reference has must survive. The difference is that in the reference, Opus wrote all of it
by hand. In the new system the engine owns the behaviour, and the LLM only fills in small pieces of data.

| Feature in kia-ch12 | Produced by (new system) | What the LLM writes |
|---|---|---|
| Architecture SVGs (role colours, dashed boundaries, arrows, animated packets) | **Diagram renderer** (`flow` DSL): layout, text fitting, arrowheads, packets, colours | A node/edge list, about 5–10 lines |
| Step-through diagrams (highlight current step, dim earlier ones, play, autoplay) | **Engine** `stepper` driven by the DSL's `steps:` | Step groups + one sentence per step |
| Slider SVG (LB vs Ingress, live totals) | **Catalog widget** `compare-scale` | 5–6 parameters |
| Fake shell (try-chips, typing, Tab, history, help, hints, catch-up, drop-down shell, shared state) | **Engine** `terminal.js`, configurable prompt/builtins per book | Canned `$ command` + output lines |
| Realistic tool output, including failure modes | Writer's canned output **+ deterministic output templates** for common commands (section 3.4) **+ optional per-book plugin** (ch12's `sim.js`) | Only outputs the templates can't derive; failure cases planned by the planner |
| Quizzes (shake, strike-through, explanation, score) | **Engine** | Question, options, one correct mark, explanation |
| Code blocks (virtual files, highlighting, copy, ▶ apply) | **Engine** + files **extracted from the source by code** | `:::code src=… hl=…` reference only |
| Labs (path matcher, host matcher, request router) | **Catalog widgets** `rule-tester`, `request-tracer` | Rules and preset test cases as data |
| Page chrome (theme, TOC with ✓, progress bar, cluster panel, tabs, callouts, recaps, tables) | **Engine + assembler** | Markdown, callouts, recap bullets |

If a feature can't be expressed this way, it becomes a **per-book plugin** written once (by you or a frontier
model), never generated per section.

---

## 2. Deterministic vs LLM: the full split

| Step | Deterministic (code) | LLM | Notes |
|---|---|---|---|
| PDF/EPUB → text | ✅ | | Layout-aware extraction (section 3.1) |
| Find chapters and sections | ✅ PDF outline/bookmarks, else font-size headings | fallback only for broken TOCs | Most technical PDFs have a usable outline |
| Strip headers, footers, page numbers, hyphenation | ✅ | | Lines repeated on most pages = header/footer |
| Detect code listings and commands | ✅ monospace font, indentation, `$` prompts, "Listing 12.3" captions | | Becomes the virtual `files/` directly |
| Chunk into sections within a token budget | ✅ | | Merge tiny sections, split huge ones at paragraph breaks |
| Key terms, numbers, commands per section | ✅ code spans, capitalised phrases, frequency, regex | | Pre-fills the digest, so the digest call shrinks |
| Section difficulty → which model writes it | ✅ heuristic score | | A deterministic **router**, no LLM needed to route |
| Section digest (concepts, gotchas, opportunities) | | ✅ cheap model | Smaller because code pre-filled half of it |
| Chapter plan (briefs, diagrams, widgets, quizzes, fixtures) | | ✅ strongest model, once | Reads digests only |
| Section prose, diagram data, quiz items, term scripts | | ✅ mid/cheap model | The only large output |
| Common command outputs (`apply`, `get`, `cat`, `ls`…) | ✅ templates from the virtual files | | Section 3.4 |
| Diagram layout and SVG | ✅ renderer | | Removes the biggest token sink of the first run |
| Quiz option order, ids, anchors, numbering, TOC | ✅ | | |
| Syntax highlighting | ✅ | | |
| Validation | ✅ | | Section 3.5 |
| Fixing simple errors | ✅ autofix first | ✅ only what code can't fix | Send the failing block only |
| Copy/plagiarism check | ✅ 8-word shingles | | |
| Coverage check (did the section explain its key terms?) | ✅ | | Catches dropped content without a judge |
| Quality judging | | ✅ | Different model family from the writer |
| Assembly (Markdown → HTML, chapter + index pages) | ✅ | | |
| Cost ledger, reports, charts | ✅ | | |

---

## 3. Build steps

Each step lists **what**, **done when**, and **API needed?**

### Step 0: Setup (no API)

1. `git init`, `.gitignore`: `sources/`, `runs/*/raw/`, `.cache/`, `.env`, and `reference/kia-ch12/sections/`
   if the repo will be public.
2. Python: recommend **`uv` on Windows** (it installs its own Python, so the missing Windows Python doesn't matter),
   with Node 24 for the engine. WSL also works; pick one and stay with it.
3. Copy the engine files out of `reference/kia-ch12/` into `engine/`. Never edit the reference.
4. Folder layout as in `HANDOFF.md` §6.1.

**Done when:** `engine/` serves the unchanged ch12 page locally.

### Step 1: Ingestion and chunking (no API)

**3.1 Extraction.** Use a library that gives font name and size per text span, so headings and code can be
recognised by their fonts. Watch the licences if this ever becomes a closed product:

| Tool | Licence | Use |
|---|---|---|
| `pdfplumber` | MIT | Spans with font name/size. Safe default |
| `pypdf` | BSD | PDF outline (bookmarks) → chapter/section page ranges |
| PyMuPDF | **AGPL** | Fastest and best, but AGPL is a problem for a closed SaaS. Fine for an open-source repo |
| `pdftotext -layout` | GPL (run as a CLI) | What the first run used; no font info |
| EPUB | — | An EPUB is a zip of XHTML: `zipfile` + `lxml`. Headings and `<pre>` are already marked up |

**3.2 Structure.** Take sections from the PDF outline. If the outline is missing, use font size/weight to find
headings (`12.2.1 …` numbering patterns help). Remove repeated header/footer lines and page numbers, join
hyphenated words, keep code blocks intact across page breaks.

**3.3 Chunks.** One chunk per section, with a token budget (e.g. 600–3,000 tokens): merge sections that are too
small into their neighbour, split oversized ones at paragraph boundaries. Each chunk is saved as JSON with: id, title,
page and line range, text, code blocks, and the extracted features below.

**3.4 Deterministic features** (these replace part of the LLM digest):
- key terms: inline code spans, capitalised multi-word phrases, terms frequent in this section but rare elsewhere
- commands (`$ …` lines), file listings and their captions, YAML/JSON blocks (parse them; record `kind`, `name`)
- numbers with units, version numbers, port numbers
- a **difficulty score**: length, code density, number of distinct terms. Used later to route easy sections to a cheaper model
- **command output templates**: for frequently used commands, derive the output from the virtual files
  (`kubectl apply -f x.yaml` → `<kind>.<group>/<name> created`, `cat x.yaml` → file contents). Writers then only
  write the command line, and the output is always consistent with the files

**Done when:** running ingestion on KiA ch12 produces the same section list as the book's TOC, code listings come
out as clean files, and a report shows tokens per chunk.

### Step 2: Engine port (no API)

> Status 2026-11-06: done as part of step 3 (3c). See step 3's status note.

1. Make the terminal configurable per book: prompt string, builtins, Tab-completion words.
2. Generalise the role colours into the generic palette (`HANDOFF.md` §6.4), with per-book aliases (`pod` → `worker`).
3. Keep `sim.js` as the optional Kubernetes plugin, loaded only by `book.yaml`.
4. Carry over every CSS fix from `HANDOFF.md` §11.

**Done when:** the original ch12 page still works on the ported engine.

### Step 3: Content format and renderers (no API)

> **Status 2026-11-06: done.**
> - **3a** `tools/build.mjs` + `tools/format/`: Markdown with `:::` blocks → one self-contained HTML page;
>   errors carry file and line. `node tools/build.mjs <chapter-dir>`.
> - **3b** `tools/format/diagram.mjs` (validate + normalise the `flow`/`sequence` shorthand at build time) and
>   `engine/js/diagram.js` (runtime layout: text measuring, box sizing, port spreading, curved edges,
>   label pills, packets, journeys, groups, steps). Widgets reuse it through `DIAGRAM.flow()`.
> - **3c** `engine/`: ported from ch13. `js/` = yaml, terminal (prompt from `chapter.yaml`, canned outputs),
>   core (code, snippet incl. SQL, quiz, tabs, stepper, widget registry, shared matchers), diagram, app.
>   `shells/` = `basic`, `kubectl-ingress` (ch12 sim), `kubectl-gateway` (ch13 sim), each with a manifest
>   listing the commands it simulates.
> - **3d** `engine/widgets/`: compare-scale, rule-tester, request-tracer, toggle-compare, condition-checker,
>   matrix-explorer, state-machine, timeline. `node tools/catalog.mjs` builds them all into one page.
> - **3e** `pipeline/skills/`: `FORMAT.md` (the writer contract) and 14 pattern skills, incl. OS and SQL ones.
> - Tests: `npm test` (23); every widget example and every skill snippet must build.
>
> **Not done / known limits:** the two kubectl simulators are still separate chapter plugins (merging them
> into one resource store is future work); `needs=`/`sets=` state flags for canned commands aren't
> implemented (stateful books use a shell plugin instead); the chapter hero art is optional raw HTML in
> `chapter.yaml`; the ch12/ch13 labs that were chapter-specific (filter lab, TLS modes, etc.) are covered
> by the generic widgets plus config, not ported one to one.

Order: **3a** format + builder (Markdown with directives → the engine's existing markup → one
self-contained HTML file), **3b** diagram DSL renderers, **3c** engine port from ch13 with the `kubectl` plugin,
**3d** catalog widgets generalised from the ch12/ch13 labs, **3e** skills library v0 + format guide.

1. Markdown + directive parser (`:::callout`, `:::code`, `:::term`, `:::diagram`, `:::quiz`, `:::widget`, `:::tabs`, `:::recap`).
2. **`flow` diagram renderer**: grid layout from `col,row`, text measuring and shrink-to-fit, arrowheads that follow
   the path, groups as dashed boundaries, packet animations, `steps:` feeding the stepper.
3. **`sequence` diagram renderer**: lifelines, messages, notes, steps.
4. Catalog widgets: `compare-scale` and `rule-tester` first, then `request-tracer`, `state-machine`, `timeline`,
   `toggle-compare`.
5. Canned `term` blocks with `needs=` / `sets=` flags and `catchup=`.
6. **Idea to try (from review):** the section writer doesn't draw diagrams at all. It writes a short,
   precise diagram brief, and a separate **diagram agent with a fresh context** (no chapter text, just the
   brief + the DSL guide + the role palette) returns the `flow`/`sequence` block. Small input, small
   output, cheap model, and the brief doubles as the figure's alt text. Measure it as its own ladder rung.
7. Write the **format guide**: the one document every writer prompt includes. Short, strict, with examples. It's
   also the largest part of the cached prefix, so keep it stable once written.

**Done when:** a hand-written test `.md` renders every directive correctly.

### Step 4: Validator, autofix, copy and coverage checks (no API)

> **Status 2026-11-06: done.** `node tools/validate.mjs <chapter-dir> --source <extract.json> [--fix] [--json r.json]`.
> Each written section is matched to its source section by `id` (ingestion now stores features per section in
> `extract.json`). Errors (fail the build/fix loop): format (all builder checks), `copy` (8+ word run shared
> with the source prose; the report quotes at most six words), `listing` (a source listing not shown as
> `:::code`), `files` (a command names a file that isn't in `files/`). Warnings: `coverage` (< 60% of the
> source's key and introduced terms), `commands` (source commands in no terminal), `inventory` (fewer tables,
> figures or callouts than the source), `numbers` (numbers in the prose found nowhere in the source or files:
> the cheap check for invented facts), `budget` (prose length vs the source, or front matter `words: [min, max]`).
> Autofix (`tools/format/autofix.mjs`): line endings, tabs, unquoted ids, `##` headings, quiz notations
> (`Q:`, `[x]`), terminal prompts (`❯`, `%`, `>`), `code src` case/path, unclosed directives. The JSON report is
> what the pipeline's fix node will read. Tests: fixtures in `tools/fixtures/validate/` (one good, one broken
> section against a synthetic source). Not done: label-length and SVG class checks beyond what the builder
> does already; consistency of names inside diagrams vs files (left to the judge).

Validator checks (from `HANDOFF.md` §7) plus:
- **coverage:** at least N% of the section's extracted key terms appear in the generated text
- **consistency:** every name used in a `term` block or diagram exists in the chapter fixtures or files
- **budget:** word count within the brief's range; label lengths within renderer limits

**Autofix before any LLM retry:** close an unclosed directive, normalise quiz markers, trim whitespace, rename
an id that differs only in case from a known one. Every error code says whether it is autofixable.

**Copy check:** 8-word shingles of the output vs the source slice → flag matches, report overlap %.

**Done when:** the validator catches a set of deliberately broken test files, and autofix repairs the simple ones.

### Step 5: Golden sections, hand-made (no API; Claude Code subscription)

> **Status 2026-11-06: eval set built; writer runs and goldens not done yet.**
> - Four books ingested for diversity: KiA (ch11), OSTEP (ch7 scheduling), Database Internals (ch2 B-Trees),
>   DDIA (ch7 transactions). Ingestion now handles "Chapter N." titles, unnumbered outlines (positional ids,
>   `--id`), per-book `x_tolerance`, and captions set in body text ("Figure 2-3.", "Figure7.1:").
> - `evals/cases/*.yaml`: five cases (clipped snippets + brief + loose expectations + ideas).
>   `python -m evals.prepare` writes `sources/evals/<id>/prompt.json`: the exact system + user messages the
>   harness will send (`pipeline/prompts/assemble.py`; the ~9k-token system prompt is identical across cases,
>   so it is the cached prefix).
> - `node tools/eval-score.mjs <case-dir> <output.md>`: must checks (builds, no copy, listings, files) +
>   a 0–100 should score (coverage, length, visuals, quizzes, terminals, invited widget, warnings).
>   `evals/rubric.md` is the judge rubric (faithful, clear, visual, interactive, polish).
> - All 5 cases run with Opus writers (results and findings in "Where we are" at the top): 1 pass, 4 fail
>   only on copying (two 8–12 word runs each), scores 90–96, ~$0.2–0.6 per section at Opus prices.
> - Next: the writer quality loop (anti-copy prompt line, re-run, judge with the rubric, keep goldens).
> - Known extraction quirks: OSTEP boxed TIP/ASIDE text and margin notes land mid-paragraph, formula
>   fractions are dropped; KiA two-line figure captions can split, a table continued across pages appears twice.

Hand-port **2–3 sections of ch12** into the new format with Claude Code in a normal interactive session. Pick sections
that are different from each other: one diagram-heavy, one shell-heavy, one with a lab widget.

They are used three ways:
1. **Proof** that the format can reach the reference quality (compare side by side with `reference/kia-ch12`).
2. **Few-shot examples** in the writers' cached prefix. This is the single biggest quality lever for cheap models.
3. **Eval references**: the judge compares generated sections with these.

**Done when:** you look at the golden sections next to the reference and you're happy with them.

### Step 6: Harness skeleton with fake providers (no API)

1. **LangGraph graph** with every node from `HANDOFF.md` §7.
2. **Provider adapter**: one small interface (`complete(prompt_parts, schema, model, effort) → text, usage`) with
   implementations for DeepSeek, Gemini and Anthropic, written as thin adapters over each official SDK.
3. **`ReplayProvider`**: returns stored outputs (the golden sections, hand-written digests and a hand-written plan).
   The whole graph runs end to end for $0, so all plumbing bugs are found before you pay anything.
4. Optional **`ManualProvider`**: writes the prompt to a file and waits for you to paste a response, so you can run a
   single node through the claude.ai chat by hand when you want to see what a strong model does with a prompt.
5. **Response cache** keyed by a hash of (provider, model, full prompt, schema). A re-run after a code change only pays
   for nodes whose input actually changed. Plus LangGraph checkpointing to resume a failed run.
6. **Ledger**: one JSONL line per call (node, provider, model, effort, input/output/cache tokens, $ from
   `config.yaml` price table, latency, cache hit yes/no). Report generator: totals per node and per model.

**Done when:** `run --provider replay` builds the chapter from fixtures and writes a ledger and a report.

### Step 7: Prompts and context engineering (write for $0; test cheaply)

**Writer prompt layout (most stable content first, so the prefix caches):**

```
[1] format guide + widget catalog + role palette        ← identical for every book    ┐
[2] golden examples (2–3 sections)                      ← identical for every book    │ cached prefix,
[3] book.yaml: glossary, shell flavour, role aliases    ← identical within a book     │ shared by all
[4] chapter plan summary + shared fixtures              ← identical within a chapter  ┘ writers in a chapter
[5] this section's brief                                ← varies
[6] this section's source slice + prev/next one-liners  ← varies
```

**What each node sees, and nothing more:**

| Node | Sees | Never sees |
|---|---|---|
| digest | one section's text + its deterministic features | other sections |
| plan | outline, all digests, extracted listings | raw text |
| write | the layout above | other sections' text |
| fix | the failing block, its error codes, the matching format-guide rule | the whole section |
| judge | source slice + generated `.md` + rubric (+ golden for pairwise) | rendered HTML, screenshots |

**Output discipline:**
- writers output the compact Markdown format, never HTML or SVG
- `max_tokens` derived from the brief's word budget
- low reasoning effort (or thinking off) for digest, write and fix; spend thinking only on the plan
- structured output (JSON schema) for digest, plan and judge
- fix calls return a patch for the failing block, not the whole section

**Done when:** prompts are versioned files under `pipeline/prompts/`, and the ledger records the prompt version.

### Step 8: First real runs on cheap models (DeepSeek / Gemini free tier)

1. **Smoke test:** one section, every node, Gemini free tier or DeepSeek. Check the ledger and the cache numbers.
2. **Full chapter on DeepSeek.** With current pricing a whole chapter should cost **cents**, so you can iterate on
   prompts many times for a few dollars.
3. Look at every section in the browser next to the reference. Write down what's worse; fix prompts, format guide or
   validator, not the output by hand.

Notes:
- Sending KiA text to DeepSeek or Gemini is fine for your own study runs, but keep it local and don't publish it.
- DeepSeek caches matching prompt prefixes automatically, and cache hits are much cheaper. The prompt layout in Step 7
  benefits from that without extra work.
- Gemini free-tier data may be used by Google to improve products. Use the CC-licensed docs there, not book text.

**Done when:** a full chapter builds with zero validator errors on a cheap model.

### Step 9: Eval (cheap API)

1. **Deterministic metrics** (free): validator pass rate on first try, fix rounds per section, copy overlap %,
   coverage %, word budget hit rate.
2. **Rubric judge** (JSON scores 1–5): accuracy against the source, clarity, use of visuals, quiz quality, shell
   realism, and **unsupported claims** (facts not in the source, a problem the first run had).
3. **Pairwise vs golden:** "which is better, A or B?" with positions swapped and both orders scored. More reliable
   than absolute scores.
4. **Use a different model family as judge than as writer** (models tend to prefer their own output).
5. **Calibrate the judge once:** you score 5–6 sections yourself and check that the judge agrees.

**Done when:** one command prints a quality table for a run.

### Step 10: Optimisation ladder (cheap models first)

Run the ladder on DeepSeek/Gemini first, to tune everything cheaply:

| Rung | Change | Measures |
|---|---|---|
| v1 | Format + DSL + validator, one model for all nodes | output tokens vs HTML/SVG |
| v2 | Routing: strong model plans, cheap model writes, difficulty router picks per section | $ per section |
| v3 | Prompt layout for caching | cache hit rate, input $ |
| v4 | Batch / off-peak where the provider offers it | $ at the same tokens |
| v5 | Deterministic pre-fill shrinks the digest; output templates shrink `term` blocks; autofix before retry | tokens per node, retries |
| control | Strongest model alone at low effort on the v1 format | Is routing worth it? |

Report cost **and** quality for every rung.

### Step 11: Claude runs (needs Anthropic credits)

1. **v0 baseline:** Opus writes HTML + hand-drawn SVG per section from the full text, as in the first run. Run it once,
   cache it, never re-run it.
2. Claude version of the ladder (Opus plans; Sonnet/Haiku write; Batches API; prompt caching).
3. Optional mixed ladder: Opus plans, DeepSeek/Gemini write. This is where a "multi-provider" claim gets its numbers.

Re-check prices and API details before this step (`HANDOFF.md` §9).

### Step 12: Public demo and README

1. Run on the kubernetes.io Ingress concept page (CC BY 4.0), with attribution.
2. Publish the page (GitHub Pages) with its cost report.
3. README: the graph diagram, cost/quality chart across rungs, a link to the demo, the "N× cheaper at equal quality" line.

---

## 4. Cost-reduction techniques, ranked by expected impact

1. **No HTML/SVG from the model.** The compact format + renderer removes most output tokens and all screenshot loops.
   Output tokens are the expensive ones, and the first run spent most of them on SVG.
2. **The frontier model reads digests, not the book.** The planner's input shrinks roughly 10×.
3. **Cheap models write; routing by a code-computed difficulty score.**
4. **Prompt caching** with the Step 7 layout; all writers in a chapter share one prefix.
5. **Response cache + checkpoints**: you never pay twice for the same call, during development or after a crash.
6. **Deterministic extraction** of files, commands and key terms: no `files` node, a smaller digest.
7. **Output templates** for common commands: shorter `term` blocks and no inconsistencies.
8. **Autofix before LLM fix; patch-only fixes**: retries cost a few hundred tokens, not a whole section.
9. **Batch / off-peak pricing** for non-urgent runs.
10. **Low reasoning effort everywhere except the plan.**

## 5. Quality-retention techniques

1. **Golden few-shot examples** in the cached prefix (they cost almost nothing once cached).
2. **A rich plan:** the planner names the diagrams, widgets, failure cases and quiz topics per section, so cheap writers
   don't have to be creative, only careful.
3. **Shared fixtures** (names, IPs, hosts, files) set once per chapter, so sections agree with each other.
4. **The renderer owns geometry**, so cheap models can't produce broken diagrams.
5. **Validator + coverage check** catch structural problems and dropped content for free.
6. **Judge with a source check** catches invented facts.
7. **Escalation:** a section that fails validation twice, or scores low with the judge, is rewritten once by a
   stronger model. Measure how often that happens; it's a good number for the README.

---

## 6. Budget estimate

Rough figures; real ones come from your ledger.

| Phase | Provider | Estimate |
|---|---|---|
| Steps 0–7 | none / Claude Code subscription | $0 |
| Step 8–10 iteration (many chapter runs) | DeepSeek | a few dollars in total |
| Smoke tests | Gemini free tier | $0, within daily limits |
| Step 11: v0 Opus baseline, one chapter | Anthropic | ~$5–15 |
| Step 11: Claude ladder + control + judge | Anthropic | ~$15–30 |
| **Total for the showcase** | | **~$30–50 of Anthropic credit, a few $ of DeepSeek** |

Set a hard budget in `config.yaml`; the harness stops a run that goes over.

---

## 7. What you can do this week for free

- [ ] Step 0 setup
- [ ] Step 1 ingestion on KiA ch12 (local only)
- [ ] Step 2 engine port
- [ ] Step 3 parser + `flow` renderer + `compare-scale`
- [ ] Step 4 validator + copy check
- [ ] Step 5 first golden section with Claude Code

## 8. Decisions for you

1. Python on Windows with `uv`, or in WSL?
2. Public GitHub repo? (affects the PDF library choice and the gitignore)
3. DeepSeek, Gemini, or both for cheap runs?
4. Diagrams DSL-only, or allow 1–2 custom SVGs per chapter?
5. Hard budget cap per run and for the whole experiment?
