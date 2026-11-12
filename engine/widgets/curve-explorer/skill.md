# curve-explorer

**Use when** the point is how one quantity changes as another varies, and the source gives the relationship
or the numbers: response time as the time slice grows, cost against the number of items, throughput against
the batch size, a hit ratio against the cache size, the book's own measurements. The reader drags sliders for
the parameters and a probe along the x axis, and reads every curve's value off at that point.

**Don't use** for a trend the author only describes in words (no formula, no numbers): say it in a sentence.
Never make up a formula or a number. A curve is either a formula the author states or one that follows
directly from their rule (the average of the completion times they describe), or the data points they print.

```
:::widget curve-explorer
title: Round robin with N jobs that arrive together
x: { label: time slice, min: 1, max: 100, unit: ms }
y: { label: response time, unit: ms }
params:
  - { id: n, label: jobs in the queue, min: 2, max: 10, step: 1, default: 3 }
curves:
  - { label: average response time, expr: "(n - 1) * x / 2" }
  - { label: measured, points: [[10, 12], [50, 61], [100, 118]] }
probe: 10
:::
```

Formulas (`expr`, quoted): numbers, `x`, the slider ids, `+ - * / ^ %`, parentheses and `min max abs floor
ceil round sqrt exp log log2 log10 pow`. A curve has `expr` or `points` (`[x, y]` pairs), not both. Curves
on one widget share the y axis, so give them the same unit.
Checklist: slider ranges cover the cases the source discusses; `probe` starts at the source's own example
value; say in the prose what to try ("drag the slice to 100 ms and watch the average").
