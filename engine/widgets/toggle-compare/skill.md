# toggle-compare

**Use when** the text contrasts two to four ways of doing the same thing and a picture of each makes the
difference obvious: TLS passthrough vs termination, write-through vs write-back, preemptive vs
cooperative scheduling, synchronous vs asynchronous replication, before/after a config change.

Keep the **same node ids and positions** in every option so only the difference changes when the
reader toggles. Use edge styles to carry meaning: `secure` for encrypted hops, `dim` for "later" or
"not used", `error` for the failure path.

```
:::widget toggle-compare
title: Where is TLS terminated?
options:
  - label: Terminate at the proxy
    diagram:
      nodes: { client: client@0 "client", proxy: gateway@1 "proxy", app: worker@2 "app pod" }
      edges: [client > proxy secure "HTTPS", proxy > app flow "HTTP"]
    points: [The proxy holds the certificate, The proxy can route by path and headers]
  - label: Passthrough
    diagram:
      nodes: { client: client@0 "client", proxy: gateway@1 "proxy", app: worker@2 "app pod" }
      edges: [client > proxy secure "TLS", proxy > app secure "TLS (untouched)"]
    points: [The app holds the certificate, The proxy only sees the SNI hostname]
:::
```

Checklist: 2–4 options; 2–5 points each, phrased so they line up across options; a sentence in the
prose telling the reader what to watch for when toggling.
