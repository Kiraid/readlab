# request-path

**Pattern:** show how one request, packet or message travels through the system, hop by hop, with the
detail that matters at each hop. Two tools:

- **flow + journeys** when *where* it goes matters (which proxy, which pod, which shard). The packet
  moves along the whole chain; steps can narrate each hop.
- **sequence** when *what is said* matters (handshakes, protocol exchanges, retries, who waits for whom).

```
:::diagram flow
nodes:
  user: client@0 "curl"
  lb: gateway@1 "proxy"
  pod: worker@2 "pod 10.244.1.12"
edges:
  - user > lb flow "Host: shop.example.com"
  - lb > pod flow "to the pod IP"
journeys:
  - user > lb > pod
steps:
  - user>lb: The request reaches the proxy with its Host header.
  - lb>pod, pod: The proxy picks a pod itself and connects to its IP directly.
:::
```

Rules:
- Label edges with what's on the wire at that hop (method, path, header, protocol, encryption).
- Use `secure` for encrypted hops, so TLS termination is visible as a colour change.
- If the path depends on the request, follow with a `request-tracer` widget so the reader can try others.
- Keep it to the hops the book discusses; don't add infrastructure the source doesn't mention.
