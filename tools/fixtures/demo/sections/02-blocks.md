---
id: "1.2"
title: The other blocks
---
::::tabs
@ Terminate
The proxy decrypts, reads the request, and picks a backend by host and path.

:::snippet http
GET /cart HTTP/1.1
Host: shop.example.com
:::
@ Passthrough
The proxy only sees the TLS handshake, so it can route by SNI hostname and nothing else.
::::

:::diagram svg
<svg viewBox="0 0 400 120" role="img" aria-label="client to proxy to service">
  <rect class="n-client" x="10" y="40" width="90" height="40" rx="10" data-step="1"/>
  <rect class="n-proxy" x="155" y="40" width="90" height="40" rx="10" data-step="2"/>
  <rect class="n-svc" x="300" y="40" width="90" height="40" rx="10" data-step="3"/>
  <path class="flow" d="M100 60 H155 M245 60 H300" marker-end="url(#arrow)"/>
</svg>
---
caption: A request crosses the proxy on its way to a Service.
steps:
  - The client sends the request to the proxy's address.
  - The proxy matches host and path against its rules.
  - The request reaches a pod behind the chosen Service.
:::

:::diagram flow
nodes:
  client: client@0 "browser"
  proxy: gateway@1 "ingress proxy"
  cart: service@2 "cart"
edges:
  - client > proxy flow "GET /cart"
  - proxy > cart flow "Prefix /cart"
caption: The same path as a DSL diagram.
:::

:::widget compare-scale
item: Service
unit: load balancer
shared: Ingress
n: { default: 6, max: 24 }
cost: { default: 18 }
:::

:::recap
- Rules name hosts, paths and Services, never pods.
- Prefix compares whole segments.
:::
