# condition-checker

**Use when** an outcome depends on several settings at once and the book lists the conditions: a route
is accepted only if the listener allows its namespace and a grant exists; a transaction sees a row only
under certain isolation levels; a process may access a file depending on owner, group and mode bits;
a deployment proceeds only if probes pass. The reader flips settings and watches each condition.

Each check passes when **every** input named in `pass_if` has one of the listed values. The verdict
passes when all checks pass (write the verdict text to match that rule; if the real rule is "any of",
say so in the checks' wording or split it into separate widgets).

```
:::widget condition-checker
title: Is the route accepted?
inputs:
  - { id: allowed, label: listener allowedRoutes, options: [Same, All, Selector] }
  - { id: ns, label: route namespace, options: [same as gateway, other] }
checks:
  - label: Listener accepts the route's namespace
    pass_if: { allowed: [All], ns: [same as gateway, other] }
    pass: All namespaces are allowed.
    fail: Pick All, or move the route next to the gateway.
verdict: { pass: Accepted, fail: "Not accepted: the status condition says why" }
:::
```

Checklist: input options use the book's exact values; every check has both `pass` and `fail`
explanations; 2–5 checks.
