# readlab

Turns technical text (book chapters, articles, docs) into interactive study pages (diagrams, step-throughs, a simulated
shell, quizzes, labs) with an LLM pipeline whose cost is measured per call.

## Layout

```
engine/js/        page runtime: terminal, core blocks + widget registry, diagram renderer, app
engine/shells/    shell plugins (basic, kubectl-ingress, kubectl-gateway), one manifest each
engine/widgets/   the global widget catalog: <name>/{widget.js, schema.json, example.yaml, skill.md}
engine/css/       style.css (from the references) + engine.css (role palette, diagrams, widgets)
tools/            build.mjs (chapter -> one HTML file), catalog.mjs, format/ (parser, renderer, diagram DSL, schema)
pipeline/ingest/  step 1: PDF -> sections -> chunks + features, no LLM
pipeline/skills/  FORMAT.md (the writer contract) + pattern skills
books/<id>/       book.yaml: source path, font-role calibration, shell flavour
tests/            Python tests (synthetic, no PDF needed) + one opt-in integration test
reference/        the hand-built ch12 and ch13 pages; read-only
sources/          (gitignored) PDFs and everything extracted from them
```

## Setup

Python runs in WSL with [uv](https://docs.astral.sh/uv/); the venv lives in `~/.venvs/interactive-book`
(venvs on `/mnt/c` are slow). Node 24 on Windows runs the engine.

```bash
./run.sh pytest                          # from WSL; from Windows: wsl ./run.sh pytest
ITB_INTEGRATION=1 ./run.sh pytest        # also runs ch12 end to end (needs the local PDF)
```

## Ingest a chapter

```bash
./run.sh python -m pipeline.ingest outline --book books/kia/book.yaml --chapter 12
./run.sh python -m pipeline.ingest fonts   --book books/kia/book.yaml --chapter 12   # calibrate font roles
./run.sh python -m pipeline.ingest chapter --book books/kia/book.yaml --chapter 12
```

Output goes to `sources/<book>/ch<NN>/`: `extract.json`, `sections/*.md`, `chunks/*.md` (one per writer
call), `files/*` (code listings) and `report.md` (structure only, no book text).

How it works: sections come from the PDF's bookmark outline. Every word gets a role from its font
(`book.yaml` maps fonts to body/code/heading/label/annotation; figure text and watermarks are dropped).
Words become lines on a shared baseline, lines become blocks (paragraphs, code with rebuilt indentation,
callouts, tables, captions, list items), and chapter-wide passes rejoin listings split across pages and
paragraphs interrupted by figures, and pin listing annotations to their code lines. Chunks respect a
token budget, and each one carries deterministic features: key terms, introduced terms, commands with
output sizes, listings with their YAML kinds, hosts/IPs/ports and a difficulty tier for model routing.

## The harness (model calls)

Paste your DeepSeek key into `.env` (gitignored; `.env.example` shows the variables). Models, prices and
per-node settings are in `pipeline/config.yaml`.

```bash
./run.sh python -m evals.prepare                                  # rebuild the writer prompts
./run.sh python -m pipeline.harness.run_eval --run ds-1           # 5 cases on deepseek-flash: write -> validate -> fix
./run.sh python -m pipeline.harness.run_eval --run dry --replay opus-2   # same graph, no API: replays saved outputs
```

Each case's drafts land in `sources/evals/<case>/out/<run>.v<N>.md`; the cost ledger and report in
`runs/<run>/` (`ledger.jsonl`, `report.md`). Calls are cached in `.cache/llm/`, so re-running only pays for
prompts that changed (`--no-cache` to force). `--budget` caps a run's spend.

## Running a chapter from a PDF

Sign in, open **Upload** and drop a PDF (a book, or an article that becomes one page). The upload reads the outline,
the cover (first page) and the words per page; no model runs yet. On the book page, **Generate** a chapter: a few
optional questions tailor it to the reader, then it goes into the Postgres job queue and a worker runs the graph.
Progress streams to the page over server-sent events (readers see stages like *Ingesting, Planning, Writing,
Judging*; admins also see models, cost and every event, and can tick "dry run"). Job files live in
`sources/jobs/<id>/`; the last step builds the page in parts (`page/dist/parts/*.html` + one cached asset bundle).
Rebuild a finished job's page with `./run.sh python -m pipeline.harness.page sources/jobs/<id>`.

## The app

FastAPI (`app/backend`) serves the API, the chapter pages and the built frontend (`app/frontend`, React + Vite).
Postgres holds users, sessions, documents, chapters (status, parts, counts), jobs (the queue) and their events,
reading progress and the full-text search index. Everything is private to its owner; `admin` only adds the run
details (models, costs, events, every job in the queue). Readers get the default models, a per-job budget cap and
an allowance of `READLAB_WORD_QUOTA` source words per `READLAB_QUOTA_DAYS` (default 30,000 per 30 days).

With Docker (in WSL): the API on http://127.0.0.1:8080, a worker, and Postgres (host port 5433).

```bash
docker compose up -d --build
docker compose run --rm api python -m app.backend.cli create-admin --email you@example.com
```

Locally, with Postgres from compose:

```bash
docker compose up -d db
./run.sh python -m app.backend.cli migrate
./run.sh python -m app.backend.cli create-admin --email you@example.com   # password: READLAB_ADMIN_PASSWORD or asked
./run.sh uvicorn app.backend.main:app --host 0.0.0.0 --port 8000           # the API
./run.sh python -m app.backend.worker                                      # the queue worker (--drain: exit when empty)
cd app/frontend && npm install && npm run build                            # or: READLAB_API=http://127.0.0.1:8000 npm run dev
```

`cli import-legacy --email you@example.com` moves the old files-only library (sources/uploads, sources/jobs,
app/library.yaml) into the database; `cli reindex` rebuilds every ready chapter's parts and search text. Tests use
a separate `readlab_test` database on the same server.

Use `127.0.0.1`, not `localhost`, from Windows: `localhost` tries IPv6 first and WSL only forwards IPv4, which
costs ~200 ms per request. For frontend work, `npm run dev` (port 5173) proxies `/api` and `/read` to the backend.

## Build a chapter

```bash
node tools/build.mjs tools/fixtures/demo --out runs/demo-build   # one self-contained index.html
node tools/catalog.mjs                                           # every widget + diagram -> runs/catalog
node tools/validate.mjs <chapter-dir> --source sources/<book>/ch<NN>/extract.json [--fix]   # check against the source
npm test                                                         # format, diagrams, schemas, validator, every example
```

A chapter folder holds `chapter.yaml` (page chrome, `shell: { plugin, user, dir, run_file }`, role
aliases), `sections/*.md` in the format described in `pipeline/skills/FORMAT.md`, and `files/` for
listings. The output opens with a double-click; `node engine/serve.mjs --content <dir>` serves it too.

## Copyright

Source PDFs and anything extracted from them stay in `sources/` and are never committed. Pages explain
concepts in original wording.
