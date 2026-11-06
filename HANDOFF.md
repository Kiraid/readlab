# Interactive Technical Book: Handoff

> **For the next agent.** This was written on 2026-11-04 by the Claude Code session that built the first
> interactive chapter by hand. It captures what was built, what the user loved, the idea that came out of it,
> and the plan to turn it into a cheap, repeatable agent pipeline. The project folder was empty when this was written.
> Read sections 1–4 for context, 5–8 for the design, 9–12 before writing code.

---

## 1. Goal

Turn chapters of **technical books** (programming, infrastructure, distributed systems, networking, databases,
security and the like; **no novels or narrative non-fiction**) into **interactive study pages**:
explanations in original wording, architecture SVGs, step-through diagrams, sliders and other interactive SVGs,
tables, quizzes in between, and a fake shell with "try" commands.

Two deliverables:

1. **A framework**: a reusable page engine plus a content format that cheap models can write reliably.
2. **An agent harness** (LangGraph is the recommendation) that produces pages like the first one at a fraction of
   the cost, with **cheaper models doing most of the work**. A frontier model only plans, divides the text and
   writes precise instructions, and deterministic checks catch the common mistakes. Make the cost reduction
   measurable so the project works as a **portfolio showcase**: "here's the first run, here's how I cut its cost by N×
   at equal quality".

---

## 2. How it started (the first run)

The user was reading *Kubernetes in Action, 2nd ed.*, chapter 12 ("Using Ingress to route traffic to services"),
and asked Claude Code to make the chapter interactive: start a web server, put the content there, use subagents,
make it creative with a hard-coded shell that shows output for a few commands, and SVG art showing the architecture.

**What the session did (Claude Opus 5.5 as orchestrator):**

1. Extracted the PDF with `pdftotext -layout`. Chapter 12 is lines 20484–22034 of the full extract (book pp. 392–420).
   **The orchestrator then read the whole chapter (about 1,550 lines) into its own context.**
2. Wrote `AUTHORING.md` (widget and markup conventions for writers) and `js/files.js` (virtual YAML manifests).
3. Spawned **4 Opus subagents**, one per chunk of the chapter. Each wrote an HTML fragment with **hand-drawn SVG**,
   built its own headless-Edge preview harness and iterated on text overlaps.
4. Meanwhile the orchestrator hand-wrote the whole engine: a YAML parser, a stateful cluster simulator, the terminal,
   widgets, CSS, the app shell and a static server (about 2,500 lines).
5. Integration, browser testing, several CSS fixes, and a detour into flaky headless-Edge screenshots.

**Cost signals:**

| What | Number |
|---|---|
| Subagent tokens | 170,078 + 181,905 + 187,012 + 173,443 = **712,438** (all Opus) |
| Subagent wall time | 13.6 / 16.1 / 16.6 / 17.3 min (in parallel) |
| Orchestrator | Not captured. It held the whole chapter plus ~3k lines of its own code, and the session was compacted twice |
| Rough content split | 23 hand-drawn SVGs + ~2,500 lines of HTML fragments + ~2,500 lines of engine |

> Claude Code token counts are **not** API dollars (cached re-reads, tool overhead, subscription billing).
> Use them only as the anecdotal "how it started". The honest baseline is **v0** in section 8, re-run inside the new harness.

**Result:** a reference implementation, **copied into this project at `reference/kia-ch12/`**
(the original stays at `C:\Users\kirai\OneDrive\Documents\kia-ch12`). Run it with `node serve.mjs` inside
`reference/kia-ch12` (http://localhost:8412). It has:

- 22 sections, 23 hand-drawn diagrams + an animated hero, **7 step-through diagrams**
- **17 inline terminals + a drop-down shell**, all sharing one simulated cluster
- **20 quizzes**, 13 manifest blocks, 4 interactive labs

`?only=s12-2-1` renders a single section, which is handy for screenshots.

---

## 3. What the user loved (the quality bar)

The user's words: *"this design is very nice like svgs; the shell, the quiz etc; it's all very nice."*
They haven't explored everything yet (for example the try-chips), so **treat every feature below as a keeper**.

| Feature | What it does in kia-ch12 | Where |
|---|---|---|
| **Architecture SVGs** | Consistent colour per role (client, proxy, controller, API object, Service, Pod, Secret, default backend, L4 LB), dashed cluster boundaries, arrows, animated "packets" moving along paths | `sections/*.html`, classes in `css/style.css` |
| **Step-through diagrams** | Numbered narrated steps beside an SVG; the current step highlights and earlier steps dim; prev/next/play; autoplays once when scrolled into view. *Example: "watch fires → join and render → configure and expose → repeat forever".* | `figure.stepper` + `widgets.js` `stepper()` |
| **Slider SVG** | "One public IP per Service, or one for all?" Dragging *services to expose* and editing *cost per load balancer* redraws two SVG panels and live totals (6 IPs / $108 vs 1 IP / $18) | `widgets.js` `lbVsIngress()` |
| **Fake shell** | Mac-style window; **try-chips** (click → typed out → runs); free typing; Tab completion; history; `help`; hints after errors; **"catch up to 12.x"** button; **drop-down shell** on the backtick key; **state shared by every terminal on the page** | `terminal.js`, `sim.js` |
| **Realistic behaviour** | kubectl and curl output imitate the real tools, including failure modes: the Ingress gets no address until the controller is ready, a bare-IP curl hits a 404, Exact `/quote` vs `/quote/`, the self-signed cert needs `-k`, the cookie keeps you on one pod, GKE/AWS objects fail with "no matches for kind", and access logs show pod IPs | `sim.js` |
| **Quizzes** | Between sections; a wrong answer shakes and strikes through, the explanation appears after a correct answer or two misses; the header counts the score | `.quiz` |
| **Code blocks** | Manifests pulled from a virtual file map, YAML highlighting, highlighted lines, copy, and **▶ apply** (runs `kubectl apply -f` in the drop-down shell) | `.code[data-src]` |
| **Labs** | Path matcher (Exact/Prefix element by element, plus a "naive startsWith would say…" trap), host/wildcard matcher, request-router playground (animated packet to the chosen pod, with a "why" explanation) | `widgets.js` |
| **Page chrome** | Dark theme (Space Grotesk / Inter / JetBrains Mono), sidebar TOC with ✓ visited marks, reading progress bar, a live "simulated cluster" panel, tabs, callouts, recap boxes, grid tables | `index.html`, `app.js`, `style.css` |

---

## 4. The idea

The first run was expensive because **a frontier model did everything free-form**. It read whole chapters,
hand-drew SVGs (output tokens cost 5× input), checked them by rendering screenshots and fixing by eye, and
hand-wrote a bespoke simulator. The plan:

- **Write the engine once.** Chapters become data.
- **Constrain the content format** (Markdown + directive blocks + a diagram DSL) so Haiku- or Sonnet-class models can write it.
- **The frontier model plans and divides; it doesn't write.** It reads short section summaries, not the raw book.
- **Deterministic validators replace render-and-look loops.**
- **Model per node is config**, so the harness "produces similar results with a different model". Quality is held by the
  format and the validators, not by model strength.
- **Measure everything** (tokens and $ per node and model, plus quality scores) and climb a cost ladder.

---

## 5. Decisions so far (recommendations; confirm with the user)

1. **Harness: LangGraph (Python)** for orchestration: `Send` fan-out, conditional validate→fix loops, checkpointing
   (resume a failed run instead of paying again), a renderable graph, LangSmith traces.
   Honest caveat: the pipeline is mostly a DAG with one loop, so plain asyncio would also work. LangGraph is chosen
   for the resume and visibility features and because it reads well on a portfolio.
2. **Call Claude through the official `anthropic` SDK inside the nodes**, not through LangChain chat-model wrappers.
   You need direct access to `response.usage`, prompt caching, structured outputs and the Batches API.
3. **Technical books only.**
4. **The public demo uses openly licensed input** (see section 10). Kubernetes in Action runs stay local.

---

## 6. Framework design

### 6.1 Repo layout (proposal)

```
interative-technical-book/
  engine/            page runtime: shell, widgets, diagram renderer, CSS, app shell, static server
  pipeline/
    graph.py         LangGraph StateGraph
    nodes/           ingest, digest, plan, write, files, validate, fix, judge, assemble
    llm.py           anthropic client wrapper: model routing, caching, structured outputs, usage ledger
    prompts/         versioned prompt files (stable text first, for caching)
    config.yaml      model per node, effort per node, price table, budgets
  tools/             validate.mjs|py, copycheck, md→html build
  evals/             rubric judge, golden sections, scoring
  reference/kia-ch12/  the hand-built first run (read-only; see 6.2)
  books/<book-id>/   book.yaml (title, shell flavour, glossary); chapters/<n>/{chapter.json, sections/*.md, files/*}
  runs/<run-id>/     ledger.jsonl, report.json, report.md, built pages
  sources/           (gitignored) PDFs and extracted text. NEVER committed.
```

### 6.2 Engine: port from `reference/kia-ch12`

Treat `reference/kia-ch12/` as read-only. Copy files out of it into `engine/` rather than editing it in place, so the
first run stays intact for the before/after comparison. Its `sections/` are original wording but are derived from the
KiA book, so leave that folder out of a public repo (gitignore it, or publish only `js/` and `css/`).

| File | Status |
|---|---|
| `terminal.js` | Reuse; make the prompt string and builtins configurable per book (bash, `psql`, a Python `>>>` REPL, `redis-cli`…) |
| `widgets.js` quiz / tabs / stepper / code blocks / HUD | Reuse |
| `style.css`, `app.js`, `serve.mjs`, `yaml.js` | Reuse; generalise the role colours (6.4) |
| `sim.js` (Ingress routing + kubectl) | Becomes an **optional per-book plugin**, kept as the example plugin |
| path matcher, host matcher, router playground, LB slider | Generalise into catalog widgets (6.5) |
| `AUTHORING.md` | Superseded by the new format guide, but read it: it shows what writers needed |

### 6.3 Content format: Markdown + directive blocks

Writers produce `sections/<id>.md`. The engine (or a build step) renders it. Proposed directives:

````md
## 12.2.2 Path-based routing
Plain Markdown prose, tables, inline `code`.

:::callout tip
Exact means exact: `/quote/` is a different path.
:::

:::code src=ing.api-example-com.yaml hl=8,11-12
:::

:::term catchup=12.2.2
$ kubectl apply -f ing.api-example-com.yaml
ingress.networking.k8s.io/api-example-com created
$ curl api.example.com/quote
"Exact means exact. A trailing slash is a different path."
:::

:::diagram flow
nodes: {client: client@0, proxy: proxy@1 "ingress proxy", quote: service@2,0, quiz: service@2,1}
edges: [client>proxy flow "GET /quote", proxy>quote "Exact /quote", proxy>quiz dim "Prefix /questions"]
steps: [[client, proxy], [quote]]
caption: One host, two Services, picked by path.
:::

:::quiz
? Does Prefix /foo match /foobar?
- yes
+ no
> Prefix compares whole path segments, not characters.
:::

:::widget compare-scale
item: Service; one: Ingress; unit_cost_label: load balancer; default_n: 6; max_n: 24; default_cost: 18
:::
````

- **`term` blocks are canned:** every `$ command` line is followed by its output. That is the "hard-coded shell" the user
  first asked for, and small models can write it reliably.
- **Optional state:** add `needs=` and `sets=` flags so the shell can answer "install the controller first".
  `catchup` sets every flag from earlier sections.
- A book that benefits from real simulation can ship a plugin, as ch12 did with Ingress routing.

### 6.4 Diagram DSL and renderer

- **`flow`:** a grid layout. Each node has a role and `col,row`. Edges have a style (`edge`, `dim`, `flow`, `secure`,
  `error`) and an optional label. Groups draw dashed boundaries. `steps` drive the stepper.
- **`sequence`:** participants (lifelines), messages, notes, steps. kia-ch12's TLS handshake and request-path diagrams
  were sequence diagrams.
- **The renderer owns all geometry:** text measuring, wrapping and shrink-to-fit, arrowheads, curve routing, packet
  animations. That makes "text overflows its box" impossible.
- **Generic role palette for any technical book:** `actor`, `client`, `gateway` (proxy / load balancer), `service`,
  `worker` (process), `datastore`, `queue`, `cache`, `controller`, `object` (config / API object), `secret`,
  `external`, `error`, `zone` (boundary). A book may alias roles (e.g. Kubernetes `pod` → `worker`).
- **Escape hatch:** `:::diagram svg` holds hand-written SVG, at most 1–2 per chapter, frontier model only. It must use
  role classes only (no hex colours) and is validated (XML parse, class whitelist).

### 6.5 Widget catalog (generalised from ch12)

Cheap models pick a template and fill in data. They never write JavaScript.

| Widget | Generalises | Example uses |
|---|---|---|
| `compare-scale` | LB-vs-Ingress slider | N replicas vs 1, N connections vs a pool, per-tenant vs shared |
| `calculator` | (new) | latency budgets, quorum sizes, cache hit math, cost per request |
| `rule-tester` | path / host matcher | prefix/exact/regex/glob/wildcard-host/CIDR matchers, with preset cases and a verdict |
| `request-tracer` | router playground | route a request through a data-defined table and animate the hop path |
| `state-machine` | (new) | click through states and transitions: TCP, pod lifecycle, a transaction |
| `timeline` | (new) | an ordered event replay: rolling update, a consensus round |
| `toggle-compare` | tabs with two diagrams | before/after, TLS passthrough vs termination |

Bespoke widgets (custom JS) are frontier-only, rare, and shipped as plugins.

---

## 7. Pipeline (graph)

```
ingest (script) → digest × N (Haiku, Send) → plan (Opus, 1 call, digests only)
  → write × N (Sonnet; Haiku for easy sections, Send) → files (Haiku)
  → validate (script) ─fail→ fix (Haiku or the same writer) ─┐
           └─pass→ judge (Sonnet rubric) → assemble (script) ┘
```

| Node | Model | Input → output |
|---|---|---|
| **ingest** | script (Haiku fallback for odd TOCs) | PDF → `pdftotext -layout` → TOC parse → per-section text files with line ranges |
| **digest** | Haiku, structured output | one section's text → JSON: concepts, definitions, commands and configs shown, facts and numbers, gotchas, diagram and interactive opportunities, quiz candidates |
| **plan** | Opus, once per chapter | all digests (**not** the raw text) → `chapter.json`: per-section brief (word budget, directives to use, diagram briefs with type and node sketch, terminal scripts, catalog widgets, quiz topics) plus shared fixtures (names, IPs, hosts, files) and a glossary |
| **write** | Sonnet default, Haiku for simple sections, low or medium effort | section text slice + its brief + format guide (cached prefix) → `section.md` |
| **files** | Haiku | virtual files (manifests, configs) the chapter references |
| **validate** | script | see the checks below |
| **fix** | Haiku (or resume the writer) | validator errors → patched `section.md` |
| **judge** | Sonnet rubric; Opus spot-checks the lowest scores | accuracy, clarity, use of visuals → scores |
| **assemble** | script | Markdown → HTML, chapter page, book index |

**Validator checks (no model):**

- every directive parses
- diagram node ids exist and labels stay under their length limits
- each quiz has exactly one correct option
- each `term` block has commands with non-empty output
- every `code src` exists in `files/`
- `#section` links resolve
- word counts are within budget
- custom SVGs parse and use only whitelisted classes
- **copy check:** flag any run of 8+ words shared with the source section, and report the overlap %

---

## 8. Measurement plan (the showcase)

Same input chapter and same quality eval for every rung. Record a per-call ledger: node, model, effort, input tokens,
output tokens, cache-read and cache-creation tokens, $ from the price table, and latency.

| Run | Change | Expected main saving |
|---|---|---|
| **v0** | Opus writes HTML + hand-drawn SVG per section from the full text (reproduces the first run) | baseline |
| v1 | Markdown + directives + diagram DSL + validator | far fewer output tokens, no render loops |
| v2 | Model routing (table above) | price per token |
| v3 | Prompt caching: format guide + plan as a stable prefix shared by parallel writers | repeated input |
| v4 | Batches API for non-urgent runs | 50% |
| control | Opus alone at low effort on the v1 format | shows whether routing earns its complexity |

**Quality has to be reported next to cost:** validator pass rate, copy-check overlap, rubric scores, and optionally a
human rating of 3 sections. The claim to make is "N× cheaper at equal or better quality".
README: the graph diagram, a cost/quality chart across runs, and a link to a sample page.

---

## 9. Claude API facts the implementer needs

Taken from the `claude-api` skill on 2026-11-04. **Re-check them (skill or live docs) before writing code; APIs drift.**

| Model | ID | Input $/MTok | Output $/MTok | Notes |
|---|---|---|---|---|
| Opus 5.5 | `claude-opus-5-5` | 4.00 | 20.00 | cache reads 0.20; default effort **medium**; thinking **cannot be disabled** (400): control it with `output_config.effort` |
| Sonnet 5.5 | `claude-sonnet-5-5` | 2.00 | 10.00 | cache reads 0.20; default effort high; to turn thinking off send `thinking: {type: "between_tools"}` (`disabled` → 400) |
| Haiku 5.5 | `claude-haiku-5-5` | 0.10 | 0.50 | for prompts ≤100K tokens (0.50 / 2.50 above); default effort medium |

- **Output costs 5× input, and thinking tokens bill as output.** Use low effort for worker nodes.
- **Structured output:** use `output_config.format` / `client.messages.parse()`. Forced `tool_choice` `any` / `tool`
  returns **400** on Opus 5.5 and Sonnet 5.5. No assistant prefill (400).
- **Do not send `temperature` / `top_p` / `top_k`** (400 under API version 2026-10-21).
- **Prompt caching:** prefix match (tools → system → messages); stable content first; minimum cacheable prefix is
  512–4096 tokens depending on the model; verify with `usage.cache_read_input_tokens`; **caches are per model**,
  so a multi-model cascade gives up cache reuse across models.
- **Batches:** 50% off, asynchronous; results come back in any order, so key them by `custom_id`.
- **Usage fields** for the ledger: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.
- **Refusals:** check `stop_reason == "refusal"`. The skill recommends server-side `fallbacks` for Opus 5.5 / Sonnet 5.5.
- Stream any request with a large `max_tokens`.
- Running the pipeline needs an **Anthropic API key, billed separately** from a Claude Code plan.

---

## 10. Licensing and copyright rules (non-negotiable)

- **Never reproduce book text** in pages or in the repo. Writers explain concepts **in their own words**: shorter,
  restructured, with their own examples. Technical terms, field names, commands and standard tool output formats are fine.
- **Don't redraw the book's figures**; design new diagrams of the same ideas.
- **Source PDFs and extracted text live in `sources/` (gitignored)** and are never committed.
- The KiA PDF on this machine isn't suitable for a public repo (its provenance shouldn't appear in a portfolio).
  **The public demo should use openly licensed input:** the Kubernetes docs are CC BY 4.0, and the
  kubernetes.io Ingress concept page covers the same material as ch12. Keep personal KiA runs local.
- The copy check (section 7) enforces the first rule automatically.

---

## 11. Lessons and gotchas from the first build

**Engine and CSS** (all fixed in kia-ch12; carry the fixes into the port):

- SVG `<text>` with no size class falls back to 16px and overflows boxes. Give it a default size.
- Inline `code` with `nowrap` caused horizontal scroll on phones. Use `overflow-wrap: anywhere`.
- Giving `thead` and `tbody` their own `display: table` misaligns columns. Don't.
- Try-chip `::before` "$" landed on its own line because the label was `display:block`. Use `inline-flex`.
- Writers asked for: `data-step` on `<g>` groups, `fill: none` on edge and zone classes, negative SMIL `begin` for
  staggered packets, arrowheads that follow path direction, and `sh` as a snippet language. **A DSL renderer removes
  this whole class of request.**

**Process:**

- Parallel writers sharing one scratch folder overwrote each other's preview files. Give every worker its own directory.
- Prose claimed behaviour the simulator didn't have (an HTTP→HTTPS 308 redirect). With canned `term` blocks the same
  writer produces both, so they stay consistent.
- One writer added facts from its own knowledge (ingress-nginx retirement dates; a cloud comparison table).
  The judge should flag claims that aren't in the source.
- Freehand SVG plus screenshot review was the single biggest token sink.

**Environment (this Windows PC):**

- **No Windows Python** (`python` is the Microsoft Store alias). Python exists in WSL/Docker. Decide early:
  `uv` on Windows, or run the pipeline in WSL.
- Node 24 is installed. `pdftotext` is at `/mingw64/bin/pdftotext` (Git Bash).
- Headless Edge screenshots (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) only worked when the
  command was **piped** (`… 2>&1 | tail`), with `--virtual-time-budget=4000` and window height ≤ 2200.
  URLs with a `#hash` rendered blank; use a query param such as `?only=` instead.
- Re-extract chapters yourself; the first run's extract lived in a temporary session folder.

---

## 12. Suggested milestones

1. **M0 – setup:** git init, `.gitignore` (`sources/`, `runs/*/raw`, and `reference/kia-ch12/sections/` if the repo
   will be public), choose the Python environment, copy the engine from `reference/kia-ch12` into `engine/`.
2. **M1 – framework:** Markdown directive renderer, `flow` and `sequence` diagram renderers, catalog widgets
   (`compare-scale` and `rule-tester` first), canned shell with flags, validator + copy check.
   **Hand-port two ch12 sections** into the format to prove it can match the original's quality.
3. **M2 – harness v0:** LangGraph graph, `llm.py` with the usage ledger, the v0 baseline run, `runs/` report.
4. **M3 – ladder:** v1 → v4 plus the control arm, the rubric judge, the README chart.
5. **M4 – public demo:** run on the kubernetes.io Ingress docs (CC BY 4.0) and publish the sample page with its cost report.

## 13. Open questions for the user

- Python (LangGraph) confirmed? Run on Windows with `uv`, or in WSL?
- Public GitHub repo? Hosting for the demo page (e.g. GitHub Pages)?
- API budget cap per run, and for the whole experiment?
- Diagrams DSL-only, or allow 1–2 custom SVGs per chapter?
- Which book or chapter after the demo? (KiA ch13 Gateway API is next in the user's reading.)
