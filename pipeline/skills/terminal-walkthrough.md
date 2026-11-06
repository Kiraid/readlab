# terminal-walkthrough

**Pattern:** a terminal with the section's commands as chips, a catch-up button, and a short "what to
look for" paragraph that tells the reader which part of the output proves the point.

```
:::term catchup=1.3
$ kubectl get ing
$ kubectl describe ing shop
:::

**What to look for:** the `ADDRESS` column stays empty until the controller has programmed the proxy;
`describe` lists every rule as host, path and backend, which is the easiest way to spot a typo.
```

Rules:
- 2–7 commands, in the book's order; one terminal per step of the story, not one giant terminal.
- Always set `catchup` to the current section id when earlier sections change state, so a reader who
  jumped in can still run the chips.
- For simulated commands, write no output (the shell answers). For anything else, give the output the
  book shows, after the `$` line (see FORMAT.md).
- Explain what a command does in one clause if it's new ("`describe` prints the rules as a table").
- Point out failure output the book discusses (an empty column, a 404, a "no matches for kind") as
  something to try on purpose.
