# os-cpu-scheduling (operating systems)

**Use for** scheduling algorithms (FCFS, SJF/SRTF, priority, round robin, multilevel queues, CFS) and
their metrics (waiting time, turnaround, response time).

Build it from:
1. One `timeline` per algorithm on **the same workload** (the book's example if it gives one), lanes
   `CPU` and optionally `ready queue`, with `say` on the moments that differ between algorithms.
2. A Markdown table of the metrics per algorithm for that workload, computed from the timelines (check
   the arithmetic: waiting = turnaround − burst).
3. `compare-scale` only if the book argues about overhead that grows with N (context switches per
   quantum, per-process kernel structures).
4. A quiz that asks what changes when the quantum or the job order changes.

```
:::widget timeline
title: FCFS with a long job first
unit: ms
lanes: [{ id: cpu, label: CPU }]
events:
  - { lane: cpu, start: 0, end: 24, label: P1, say: P1 needs 24 ms and arrived first; everyone waits. }
  - { lane: cpu, start: 24, end: 27, label: P2 }
  - { lane: cpu, start: 27, end: 30, label: P3, say: "P3 waited 27 ms for a 3 ms job: the convoy effect." }
:::
```

Checklist: identical workloads across algorithms; times add up; ties broken the way the book says;
preemption shown as the job reappearing later on the same lane.
