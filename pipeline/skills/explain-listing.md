# explain-listing

**Pattern:** show the listing, highlight the lines that matter, then walk through them by line number in
two to four sentences, saying what each does and why it has that value.

```
:::code src=svc.cart.yaml hl=4,7,10-12
:::

The name (line 4) is what other objects use to find this Service. The type stays `ClusterIP` (line 7):
only the proxy inside the cluster talks to it. The `http` port (lines 10–12) is the one we route to:
port 80 on the Service, 8080 in the pods.
```

Rules:
- Highlight the lines the book annotates, plus any line your prose mentions. Line numbers in the prose
  must match the file (the builder checks `hl`, you check the prose).
- Lead with the purpose of the whole manifest in one sentence before the listing when it isn't obvious.
- Explain values, not just keys: "80 on the Service, 8080 in the pods" beats "the ports section".
- Long listings: highlight in groups and explain group by group; never paraphrase every line.
- Partial YAML that isn't a file (a `status:` block, a fragment) goes in `:::snippet yaml`.
