# sql-transactions (databases)

**Use for** concurrency anomalies (dirty read, non-repeatable read, phantom, lost update, write skew),
isolation levels, locks and MVCC snapshots.

Build it from:
1. One `timeline` per anomaly: a lane per transaction, short events per statement (`read x=10`,
   `write x=11`, `commit`), the harmful step with `role: error` and a `say` that names the anomaly.
   Use `marks` for commits.
2. A `matrix-explorer` of isolation level × anomaly (possible / prevented), with each item's `text`
   explaining the mechanism that prevents it (snapshot, lock, abort) as the book states it.
3. A `:::term` (basic shell, canned output) or `:::snippet sql` with two sessions' statements when the
   book walks through it in `psql`; label sessions clearly ("session A", "session B").
4. A quiz: "at Repeatable Read, what does T2 see in step 3?"

```
:::widget timeline
title: Non-repeatable read at Read Committed
unit: " step"
lanes: [{ id: t1, label: T1 }, { id: t2, label: T2 }]
events:
  - { lane: t1, start: 0, end: 1, label: read x=10 }
  - { lane: t2, start: 1, end: 2, label: write x=20 }
  - { lane: t2, start: 2, end: 3, label: commit }
  - { lane: t1, start: 3, end: 4, label: read x=20, role: error, say: "T1 reads the same row twice and gets two answers." }
:::
```

Checklist: the isolation level stated on every example; the database's own behaviour as the book
describes it (engines differ: say which one); values consistent from step to step.
