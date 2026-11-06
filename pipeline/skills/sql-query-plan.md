# sql-query-plan (databases)

**Use for** `EXPLAIN` output, join algorithms, and when an index can or can't be used.

Build it from:
1. The query and its plan as `:::snippet sql` and `:::snippet text` (with the `basic` shell, a
   `:::term` with `$ psql -c "EXPLAIN …"` and the plan as canned output also works).
2. A flow diagram of the plan tree, **leaves on the left, result on the right**, with steps that run
   bottom-up, so the reader sees rows flowing from scans through joins to the output. Put row estimates
   in `sub`.
3. A `condition-checker` for "will the planner use this index?" (leading column, no function on the
   column, a fixed-prefix comparison, selectivity) when the book discusses it.

```
:::diagram flow
nodes:
  so: datastore@0,0 "Seq Scan orders" "rows≈10000"
  ic: datastore@0,1 "Index Scan customers" "rows≈1"
  hj: process@1,0 "Hash Join" "rows≈40"
  out: object@2,0 "result"
edges:
  - so > hj flow "orders"
  - ic > hj flow "build hash"
  - hj > out flow
steps:
  - ic, ic>hj: The inner side is read first and loaded into a hash table.
  - so, so>hj: Each order row probes the hash table.
  - hj, hj>out, out: Matches stream out as the result.
caption: Plan tree, read from the leaves.
:::
```

Checklist: node names exactly as the plan prints them; estimates from the book's output, never made
up; say which side is built and which is probed, as the book describes it.
