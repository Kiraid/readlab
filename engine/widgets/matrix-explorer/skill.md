# matrix-explorer

**Use when** the book classifies things along two axes and the reader should find where each example
falls: feature × release channel/support level, isolation level × anomaly, consistency model ×
guarantee, signal × default action, storage class × access pattern. Better than a static table when
there are examples to click and explain.

```
:::widget matrix-explorer
title: Release channel × support level
rows: [{ id: standard, label: Standard }, { id: experimental, label: Experimental }]
cols: [{ id: core, label: Core }, { id: extended, label: Extended }]
cells:
  standard/core: Every implementation must support it.
items:
  - { label: HTTPRoute, row: standard, col: core, text: Stable API that every implementation supports. }
:::
```

Checklist: axis values and item placement exactly as the book states them; `text` explains *why* the
item sits there, in one or two sentences; 4–12 items. If there is nothing to click, use a Markdown
table instead.
