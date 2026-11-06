# Section format (the writer contract)

You write one section as Markdown with `:::` blocks. You never write HTML, CSS, JavaScript or SVG
coordinates: the builder and the engine own all of that. Run-time checks reject anything outside this
contract, with the line number, so follow it exactly.

## File shape

```
---
id: "12.2.1"                 # the book's number, quoted
title: Exposing a service through an Ingress
pages: 398-402               # the book's printed pages, from the brief
---
Prose in Markdown: paragraphs, **bold**, *italic*, `code`, lists, GFM tables, #### sub-headings.
```

Do not write `#`, `##` or `###` headings: the section heading comes from the front matter. Book
sub-headings (often in small caps) become `####` in sentence case.

## Blocks

| Block | Body | Notes |
|---|---|---|
| `:::callout note\|tip\|warn\|definition\|important\|caution\|sidebar` | Markdown | `title="..."` overrides the label |
| `:::code src=FILE hl=8,11-12` | empty | FILE must exist in the chapter's `files/`; `hl` = lines to highlight |
| `:::snippet yaml\|http\|sql\|bash\|json\|text` | verbatim text | for partial configs, output fragments, requests |
| `:::term catchup=12.2.1` | `$ command` lines | see "Terminals" below |
| `:::quiz` | `? q` / `- wrong` / `+ right` / `> why` | exactly one `+` |
| `::::tabs` | `@ Label` lines start panels | four colons, so the panels can contain `:::` blocks |
| `:::recap` | Markdown list | end of a longer section |
| `:::diagram flow` / `:::diagram sequence` | YAML (below) | `:::diagram svg` is frontier-only |
| `:::widget NAME` | YAML config | NAME from the catalog; see each `engine/widgets/NAME/skill.md` |
| `:::widget-request` | YAML: `name`, `shows`, `inputs`, `fallback` | when no catalog widget fits |

## Terminals

```
:::term catchup=12.2.2
$ kubectl apply -f ing.api.yaml
$ kubectl get ing
:::
```

Each `$` line becomes a clickable chip in the shared shell. `catchup` adds a button that puts the shell
in the state the reader would have at the start of that section.

Lines after a `$` command are its **canned output**. Give output only for commands the chapter's shell
plugin does **not** simulate (the brief says which plugin and what it handles; the `basic` shell
simulates nothing but builtins). For simulated commands, leave the output out: the simulator answers,
and its state stays consistent. The builder drops canned output for simulated commands with a warning.

## Diagrams

```
:::diagram flow
nodes:                                  # id: role@col,row "label" "sub"
  client: client@0,1 "browser"
  proxy: gateway@1,1 "ingress proxy" "11.22.33.44"
  quote: service@2,0 "quote"
  quiz: service@2,2 "quiz"
groups:                                 # dashed boundary with a label
  cluster: { nodes: [proxy, quote, quiz], label: kubernetes cluster }
edges:                                  # from > to style "label"
  - client > proxy flow "GET /quote"
  - proxy > quote flow "Exact /quote"
  - proxy > quiz dim "Prefix /questions"
journeys:                               # a packet that travels a whole chain
  - client > proxy > quote
steps:                                  # ids: narration (nodes and edges)
  - client, client>proxy: The browser connects to the proxy's address.
  - proxy>quote, quote: The path matches the Exact rule, so quote gets it.
caption: One host, two Services, picked by path.
:::
```

- **Roles** (colour and meaning): `actor client gateway service worker datastore queue cache controller
  object secret external error process resource note`. A book may add aliases (`pod: worker`); the brief
  lists them.
- **Edge styles**: `edge` plain, `dim` not taken/later, `flow` animated traffic, `secure` encrypted,
  `error` failing path, `ok` success.
- **Grid**: columns left to right, rows top to bottom. Leave a column empty rather than squeezing; no two
  nodes in the same cell. Labels ≤ 40 characters, subs ≤ 36, edge labels ≤ 44: put detail in prose.
- Packets: every `flow`/`secure`/`error` edge gets one, unless you list `journeys` (then only those
  move) or set `packets: false`.

```
:::diagram sequence
participants:                           # id: role "label" "sub"
  c: client "curl"
  p: gateway "proxy"
  s: worker "pod"
messages:                               # "a > b": label · "a --> b": reply (dashed) · "note a": text
  - c > p: ClientHello (SNI kiada.example.com)
  - p --> c: certificate for kiada.example.com
  - p > s: GET / (plain HTTP inside the cluster)
  - note p: decrypts, reads Host and path
steps: auto                             # every message becomes a step
caption: TLS terminated at the proxy.
:::
```

## YAML traps (the builder reports these, but avoid them)

- Inside `[ ... ]` and `{ ... }` a comma ends the value. Write edge lists as block lists (one `- ` per
  line), and quote any value that contains a comma: `why: "No match, so 404."`.
- `a > b: label` is a map, not a string. Edges never have a colon; sequence messages always do.
- Quote values that start with `*`, `&`, `!`, `@`, `%`, `` ` `` or look like numbers you mean as text
  (`"80"`, `"yes"`, `"no"`).

## When nothing fits

```
:::widget-request
name: page-table-walk
shows: How a virtual address is split into page number and offset and translated through the page table.
inputs: a virtual address; page size
fallback: The worked example in the table above shows the same translation step by step.
:::
```

The page shows the fallback text; the request is queued for the widget builder. Don't write code.
