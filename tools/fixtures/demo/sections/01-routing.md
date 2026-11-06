---
id: "1.1"
title: Routing by host and path
pages: 10-12
---
An Ingress is a table of routes. Each rule names a **host**, a **path** and the Service that should get the
request. You never list pods here: the controller looks those up through the Service.

:::code src=ing.demo.yaml hl=7,10-11,14
:::

The host (line 7) is compared with the request's `Host` header. The path and its type (lines 10–11) decide
whether `/cart/items` still counts, and line 14 names the Service that receives the request.

:::callout note
The Service can stay `ClusterIP`. The proxy runs inside the cluster, so an internal address is all it needs.
:::

:::term catchup=12.2.1
$ kubectl apply -f ing.demo.yaml
$ kubectl get ing demo
:::

| pathType | `/cart` matches `/cart/items`? |
|---|---|
| `Exact` | no |
| `Prefix` | yes |

:::quiz
? Does a `Prefix` rule for `/cart` match `/carts`?
- Yes, it starts with the same characters
+ No, prefixes compare whole path segments
- Only with a trailing slash
> Prefix matching splits the path at `/` and compares segment by segment, so `/carts` is a different segment.
:::
