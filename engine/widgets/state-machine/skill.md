# state-machine

**Use when** the book describes something that moves between named states on events: process states
(new, ready, running, waiting), TCP connection states, a pod's phases, a transaction (active, committed,
aborted), a circuit breaker, an order workflow. The reader clicks the transitions out of the current
state and builds a path; notes explain the non-obvious moves.

The `diagram` is a flow diagram: nodes are states (pick roles for meaning, e.g. `gateway` for the
active state, `queue` for waiting, `object` for final), edges are transitions labelled with the event.
`notes` keys are state ids or edge ids (`running>ready`).

```
:::widget state-machine
title: TCP connection close
diagram:
  nodes:
    est: process@0 "ESTABLISHED"
    fw1: queue@1 "FIN_WAIT_1"
    fw2: queue@2 "FIN_WAIT_2"
    tw: object@3 "TIME_WAIT"
  edges:
    - est > fw1 edge "close(), send FIN"
    - fw1 > fw2 edge "ACK received"
    - fw2 > tw edge "FIN received"
start: est
notes:
  tw: Waits two segment lifetimes so late packets can't confuse a new connection.
:::
```

Checklist: every state and transition the book names, with its exact name; notes on the 1–3
transitions people get wrong; no more than ~8 states (split bigger machines).
