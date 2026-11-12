# timeline

**Use when** the order and overlap of things over time is the point: CPU scheduling (FCFS, SJF, round
robin), two transactions interleaving (and where the anomaly happens), a rolling update replacing pods,
a consensus round, retries with backoff, cache expiry. The reader plays or scrubs a playhead; bars
light up while active and the narration (`say`) for the latest event appears.
A list of dates (a field's history) or a trend with no real time axis reads better as a sentence or a list.

Lanes are rows (a CPU, a process, a transaction, a replica). Events are bars on a lane from `start` to
`end`. `marks` are vertical lines for moments (a commit, a crash, a deadline).

```
:::widget timeline
title: Lost update
unit: " step"
lanes: [{ id: t1, label: T1 }, { id: t2, label: T2 }]
events:
  - { lane: t1, start: 0, end: 1, label: read x=10, say: "Both transactions read the same value, 10." }
  - { lane: t2, start: 1, end: 2, label: read x=10 }
  - { lane: t1, start: 2, end: 3, label: write x=11 }
  - { lane: t2, start: 3, end: 4, label: write x=11, role: error, say: "T2 overwrites T1's write: one increment is lost." }
marks: [{ at: 4, label: both commit }]
:::
```

Checklist: times are consistent (no overlapping bars on one lane unless the book says so); one `say`
per step that matters; the example follows the book's own numbers when it gives them.
