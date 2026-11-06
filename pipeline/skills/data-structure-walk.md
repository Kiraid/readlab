# data-structure-walk

**Use for** a lookup, insert or delete through a structure: a B-tree or B+tree index, a hash table with
buckets, a linked list, a trie, a page table, an LSM tree's levels. The steps follow the operation; the
highlighted path is the cost the book talks about.

Build it from a flow diagram laid out as the structure (root on the left, leaves to the right, or top to
bottom with rows), with steps that light up one node per comparison, and the comparison in the
narration.

```
:::diagram flow
nodes:
  root: object@0,1 "[ 40 | 80 ]"
  l: object@1,0 "[ 10 | 25 ]"
  m: object@1,1 "[ 50 | 65 ]"
  r: object@1,2 "[ 90 | 99 ]"
  leaf: datastore@2,1 "65 → row 0x1f3"
edges:
  - root > l dim "< 40"
  - root > m edge "40–80"
  - root > r dim "> 80"
  - m > leaf edge "65"
steps:
  - root: "Looking for 65: 40 ≤ 65 < 80, so take the middle child."
  - root>m, m: "In the middle node, 65 is found among the keys."
  - m>leaf, leaf: The leaf entry points at the row's location.
caption: Three node visits instead of scanning every row.
:::
```

Checklist: keys and fan-out from the book's example; one step per node visit; say the cost (node visits,
probes, disk reads) in the last step or the caption, as the book frames it.
