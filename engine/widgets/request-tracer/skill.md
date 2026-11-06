# request-tracer

**Use when** something routes requests (or messages, packets, jobs) to one of several destinations
based on their fields, and the reader learns best by sending a few and watching where each lands: an
Ingress or gateway picking a backend, a load balancer, a message router, a syscall dispatcher, a query
router picking a shard.

The `diagram` is an ordinary flow diagram (see the diagram skill). Routes are checked in order; the
first whose `when` conditions all match is taken, and the packet travels its `via` chain. `fallback`
is the default (a 404, a dead-letter queue, a default shard).

```
:::widget request-tracer
title: Where does this request go?
diagram:
  nodes:
    client: client@0,1 "curl"
    proxy: gateway@1,1 "ingress proxy"
    kiada: service@2,0 "kiada"
    quote: service@2,1 "quote"
    def: error@2,2 "default backend"
  edges: [client > proxy, proxy > kiada, proxy > quote, proxy > def]
fields:
  - { name: host, options: [kiada.example.com, api.example.com, other.example.com] }
  - { name: path, default: / }
routes:
  - { when: { host: kiada.example.com }, via: client > proxy > kiada, result: kiada pod }
  - { when: { host: api.example.com, path: "exact:/quote" }, via: client > proxy > quote, result: quote pod }
fallback: { via: client > proxy > def, result: 404 from the default backend, error: true }
:::
```

Checklist: every `via` follows existing edges; routes are in the order the system evaluates them;
`why` says the rule in one sentence; presets cover a hit, a near-miss and the fallback.
