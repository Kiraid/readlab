# os-process-lifecycle (operating systems)

**Use for** process and thread states, what moves a process between them, and what the kernel does on
each move (context switch, blocking system call, signal, exit and reaping).

Build it from:
1. A `state-machine` widget with the book's states and transitions, `notes` on the transitions people
   get wrong (I/O completion goes to *ready*, not *running*; a zombie has exited but not been reaped).
2. A `process-stepper` flow diagram for the mechanism behind one transition, for example a context
   switch: save registers → pick next → switch address space → restore registers.
3. A `terminal-walkthrough` if the book uses commands (`ps -o pid,stat,cmd`, `top`), with the state
   letters explained in "what to look for". With the `basic` shell, give their output after the `$` line.

```
:::diagram flow
nodes:
  a: process@0,0 "process A" "running"
  k: controller@1,0 "kernel"
  b: process@2,0 "process B" "ready"
  pcb: datastore@1,1 "PCBs" "saved registers"
edges:
  - a > k flow "timer interrupt"
  - k > pcb edge "save A"
  - pcb > k edge "load B"
  - k > b flow "resume"
steps:
  - a, a>k: The timer fires while A runs and traps into the kernel.
  - k>pcb, pcb: The kernel saves A's registers in A's control block.
  - pcb>k: It loads B's saved registers.
  - k>b, b: B resumes exactly where it stopped.
caption: A context switch.
:::
```

Checklist: state names exactly as the book uses them (they differ between books and systems); every
transition the book lists; the cost of a context switch stated only if the book gives it.
