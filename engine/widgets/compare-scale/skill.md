# compare-scale

**Use when** the text argues that giving every item its own X doesn't scale and one shared X is better:
a load balancer per Service vs one Ingress, a connection per request vs a pool, a process per client vs a
thread pool, a VM per app vs shared nodes. The reader drags the item count and watches the totals diverge.

**Don't use** when the comparison isn't "N of something vs 1 shared" (use `toggle-compare` for two
designs side by side, or a table).

```
:::widget compare-scale
title: One public IP per Service, or one for all?
item: Service
unit: load balancer
shared: Ingress
n: { default: 6, max: 24 }
cost: { default: 18, label: cost per load balancer / month }
note: Numbers are illustrative; check your provider's pricing.
:::
```

Checklist: `item` and `unit` are short nouns (they label boxes); a `cost` only when the book gives or
implies one (otherwise leave it out and the widget compares counts); say in the prose what to try
("drag to 20 and compare the totals").
