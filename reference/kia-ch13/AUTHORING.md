# Authoring guide — interactive chapter 13 (Gateway API)

The site is `index.html` + `css/style.css` + `js/*.js`. Section content lives in
HTML fragments in `sections/`, loaded in order at runtime. Fragments are plain
HTML: **no `<script>`, no `<style>`, no `<html>/<body>`**. All behaviour comes
from the widget conventions below, which `js/app.js` wires up.

Fragments: `01-intro.html` (13 intro + 13.1), `02-gateway.html` (13.2),
`03-httproute.html` (13.3.1–13.3.2), `04-routing-filters.html` (13.3.3–13.3.4),
`05-tls-l4.html` (13.4–13.5), `06-namespaces-mesh.html` (13.6, 13.7, summary).

## Content policy — stay true to the book

This is a personal study copy. The reader wants the page to replace re-reading
the chapter, so **cover everything the book section covers**, in the book's
order and with its section numbers and headings:

- every concept, field, default value, condition type and reason, caveat and
  "at the time of writing" remark (e.g. Istio not supporting UDPRoute/GRPCRoute);
- every listing → a `data-src` code block from `js/files.js` (they mirror the
  book's listings) with `data-hl` on the lines the book annotates, and the
  annotations explained in the prose around it;
- every command and its output → a terminal chip (the simulator reproduces the
  book's outputs) or a `pre.snippet`;
- every table → a `<table class="grid">` with the same rows (condition, meaning,
  reasons);
- every figure → your own SVG diagram of the same idea (better if animated/stepped);
- sidebars (e.g. "About Kustomize") → a callout.

Write the prose as your own explanation, paraphrasing rather than pasting the
book's paragraphs, but keep every fact. You may add short "why it matters" or
"gotcha" notes and comparisons with chapter 12 (Ingress), as long as nothing
from the book is dropped. Tone: a sharp friend at a whiteboard. Short paragraphs.
Aim for roughly 200–450 words of prose per subsection, broken up by visuals.

## Structure

Flat sequence of sections (no nesting across files):

```html
<section class="major" id="s13-2">
  <h2><span class="num">13.2</span> Deploying a Gateway</h2>
  <p>short intro…</p>
</section>
<section class="sub" id="s13-2-1">
  <h3><span class="num">13.2.1</span> Understanding Gateway classes</h3>
  …content…
</section>
```

Book sub-headings inside a subsection (e.g. "CREATING A GATEWAY OBJECT MANIFEST")
become `<h4>` in sentence case. Use `<p>`, `<ul>/<ol>`, `<code>`, `<kbd>`,
`<dfn>`, `<table class="grid">`.

## Widgets

### Callouts
```html
<aside class="callout note"><b>Note</b> text</aside>   <!-- also: tip, warn -->
```
Book NOTE → `note`, TIP → `tip`, WARNING → `warn`, DEFINITION → `note` with `<b>Definition</b>`.

### Manifests from the virtual directory (preferred over pasting YAML)
`js/files.js` defines the files. **Read it** to know what each contains and to
get line numbers right.
```html
<div class="code" data-src="gtw.kiada.yaml" data-hl="8,9-13"></div>
```
`data-hl` = 1-based line numbers to highlight (optional).

Other snippets (status blocks, partial YAML, HTTP requests): HTML-escape the content.
```html
<pre class="snippet" data-lang="yaml">status:
  addresses:
  - type: IPAddress
    value: 172.18.255.200</pre>
```
`data-lang` may be `yaml`, `http`, `text`, `json`, `proto`.

### Fake terminal (shared cluster state across the whole page)
```html
<div class="term" data-catchup="13.3.1">
  <code class="cmd">kubectl apply -f httproute.kiada.yaml</code>
  <code class="cmd">kubectl get httproutes</code>
</div>
```
Each `<code class="cmd">` becomes a clickable chip (click = typed + run). The
reader can also type freely. `data-catchup="X"` adds a "Catch up" button that
puts the cluster in the state the reader would have *at the start of* section X.
Escape `&`, `<`, `>` in commands. Use 2–7 chips per terminal, in the book's order.
Only use commands from the list below.

**Prompt context:** user is in `~/Chapter13`, namespace `kiada`, kind cluster.
SETUP (already applied when the page loads): pods `kiada-001..003` (labels
`app=kiada, rel=stable`, Kiada 0.5), `quote-001..003`, `quiz`; services `kiada`,
`quote`, `quiz` (ClusterIP); secret `kiada-tls`. **Nothing Gateway-related is
installed at first** (no CRDs, no Istio). Gateway `kiada` gets address
`172.18.255.200`; gateway `test-gtw` gets `172.18.255.201`; gateway `shared`
(in `gateway-namespace`) gets `172.18.255.202`. Envoy pod for kiada:
`kiada-istio-86c59d8dd6-jfrnv`, service `kiada-istio`.

**Supported commands** (anything else prints a hint):
- `help`, `clear`, `ls`, `ls SETUP`, `cat <file>`, `cat /etc/hosts`, `history`, `reset`, `catchup <section>`
- `for i in {1..10}; do <command>; done` (any command, up to 50 iterations)
- `kubectl create ns kiada`, `kubectl config set-context --current --namespace kiada`, `kubectl apply -f SETUP -R`
- `kubectl get crd gateways.gateway.networking.k8s.io`, `kubectl get crd` (NotFound / list)
- `kubectl apply -k github.com/kubernetes-sigs/gateway-api/config/crd/experimental` (installs CRDs)
- `curl -sL https://istio.io/downloadIstioctl | sh -`, `export PATH=$HOME/.istioctl/bin:$PATH`
- `istioctl install -y --set profile=minimal` (installs istiod in `istio-system`; Ready ~10 s later)
- `kubectl get pods -n istio-system`
- `gcloud container clusters update <name> --gateway-api=standard --region=<region>` (explains it's GKE-only)
- `kubectl get gatewayclasses`, `kubectl get gatewayclass istio -o yaml`
- `kubectl get gtw|gateways [name] [-n ns|-A] [-o yaml|wide]`, `kubectl describe gtw <name>`
- `kubectl get gw` (Istio's *other* Gateway kind — prints "No resources found" + a gtw-vs-gw hint)
- `kubectl get httproutes|httproute|tlsroutes|tcproutes|udproutes|grpcroutes|referencegrants [name] [-n ns] [-o yaml]`
- `kubectl describe httproute <name>`
- `kubectl get pods|svc|services|endpoints|endpointslices|secrets|ns [name] [-l selector] [-o wide|yaml] [-n ns]`, `kubectl get ns --show-labels`
- `kubectl get service kiada-istio -o wide`, `kubectl get pods -l istio.io/gateway-name=kiada`
- `kubectl apply -f <file>` (any file in files.js), `kubectl delete -f <file>`, `kubectl delete httproute|tlsroute|tcproute|udproute|grpcroute|gtw <name>`
- `kubectl label ns kiada part-of=kiada`
- `kubectl logs <pod> [-c kiada]` (kiada pods log every request they receive, incl. mirrored ones, with path and Host)
- `kubectl explain gateway.spec`, `kubectl explain httproute.spec.rules`
- `echo "172.18.255.200 kiada.example.com api.example.com" | sudo tee -a /etc/hosts`
- `curl [-v] [-k] [-I] [-s] [-X METHOD] [-H "Name: value"]... [--resolve host:port:ip] <url>` —
  routed by real Gateway API logic against the current state (listener port/protocol/hostname,
  HTTPRoute hostnames, matches incl. method/path/headers/queryParams and precedence, weights,
  filters, TLS terminate/passthrough + TLSRoute, missing routes → 404, no listener → connection
  refused / no route to host). Example: `curl --resolve kiada.example.com:80:172.18.255.200 http://kiada.example.com`
- `echo hello | nc 172.18.255.201 200` (TCPRoute → "You said: hello"), `nc 172.18.255.201 200`,
  `nc --udp 172.18.255.201 300` (no reply: Istio doesn't implement UDPRoute)
- `grpcurl -proto yages-schema.proto --plaintext test.example.com:900 yages.Echo.Ping` (fails: GRPCRoute not handled by Istio in the book's version)

Catch-up section ids: `13.1.3 13.2 13.2.1 13.2.2 13.2.3 13.3 13.3.1 13.3.2 13.3.3 13.3.4
13.4 13.4.1 13.4.2 13.5 13.5.1 13.5.2 13.5.3 13.6 13.6.1 13.6.2 13.7`.

### Step-through diagram
```html
<figure class="diagram stepper">
  <svg viewBox="0 0 760 300" role="img" aria-label="…">
    … elements with data-step="1", data-step="2" … (unstepped = always visible)
  </svg>
  <ol class="steps"><li>step 1 text</li><li>step 2 text</li></ol>
  <figcaption><b>Figure 13.x</b> caption</figcaption>
</figure>
```
Prev/Next/Play controls are added automatically. Elements with
`data-step="n"` are dimmed until step n, highlighted at step n.

### Plain diagram
```html
<figure class="diagram">
  <svg viewBox="0 0 760 320" role="img" aria-label="…">…</svg>
  <figcaption><b>Figure 13.x</b> caption</figcaption>
</figure>
```
SVG rules: dark theme. **Use only these classes for colour** (no hex colours):
- node boxes (`<rect rx="10">`): `n-gtw` (Gateway object), `n-route` (any Route object),
  `n-gwclass` (GatewayClass / IngressClass), `n-ingress` (Ingress object, for ch.12 comparisons),
  `n-proxy` (Envoy / the actual proxy), `n-ctrl` (controller, istiod), `n-api` (API server /
  generic k8s object such as ReferenceGrant or CRD), `n-svc`, `n-pod`, `n-secret`,
  `n-default` (404 / rejected), `n-lb` (LoadBalancer service / cloud LB), `n-client`, `n-dns`,
  `n-zone` (dashed cluster boundary), `n-ns` (dashed namespace box)
- text: `lbl` (13px), `lbl-b` (bold), `lbl-sm` (11px muted), `lbl-mono` (monospace),
  `lbl-xs` (10px). Add `t-<role>` to colour text: `t-gtw`, `t-route`, `t-gwclass`, `t-client`,
  `t-proxy`, `t-ctrl`, `t-svc`, `t-pod`, `t-api`, `t-secret`, `t-default`, `t-muted`
- lines: `edge` (plain arrow line), `edge-dim`, `flow` (animated marching dashes),
  `flow-tls` (pink animated), `flow-bad` (red animated). Arrowheads: put
  `marker-end="url(#arrow)"` (or `#arrow-tls`, `#arrow-bad`, `#arrow-accent`) — the markers are
  defined once globally in index.html, do NOT define your own.
- moving packet: `<circle class="packet" r="5"><animateMotion dur="2.4s" repeatCount="indefinite" path="M…"/></circle>`
  (`packet-tls`, `packet-bad` variants)
- `badge` rect + `badge-t` text for small pills (e.g. "L7", "TLS", "v1alpha2").
Use `text-anchor="middle"` and keep text ≥ 11px at viewBox width 760. Lay out
generously, check that no text overlaps or overflows its box (estimate ~7px per
character at 13px, ~7.5px for mono). Diagrams scale to the column width (~760px).
Make them good — these are a highlight of the page.

### Tabs (e.g. compare two approaches)
```html
<div class="tabset">
  <div class="tabs"><button data-tab="a">Terminate</button><button data-tab="b">Passthrough</button></div>
  <div class="tab-panel" data-tab="a">…</div>
  <div class="tab-panel" data-tab="b">…</div>
</div>
```

### Built-in interactive widgets (place the empty div; the JS fills it)
- `<div class="widget weight-splitter"></div>` — two backends with weight sliders; fires a
  batch of requests and shows the observed split vs. the expected share (13.3.2)
- `<div class="widget httproute-lab"></div>` — pick a preset route (method / header /
  header-regex / path / query / combined) and build a request (method, path, query, headers);
  shows which rule matches and why each condition passes or fails (13.3.3)
- `<div class="widget filter-lab"></div>` — pick a filter (RequestHeaderModifier,
  ResponseHeaderModifier, URLRewrite full/prefix, RequestRedirect, RequestMirror) and a
  request; shows the request the backend receives / the response the client gets (13.3.4)
- `<div class="widget tls-modes"></div>` — Terminate vs Passthrough toggle: which hops are
  encrypted, what the gateway can see, which route kind and listener protocol you need (13.4)
- `<div class="widget xns-lab"></div>` — cross-namespace permission lab: listener
  `allowedRoutes` (Same/All/Selector + namespace label), backend namespace and ReferenceGrant;
  shows the route's Accepted / ResolvedRefs conditions with reasons (13.6)
- `<div class="widget support-matrix"></div>` — release channel × support level explorer
  with example features (13.1.2)

### Quiz
```html
<div class="quiz">
  <p class="q">Question?</p>
  <button class="opt">Wrong answer</button>
  <button class="opt" data-correct>Right answer</button>
  <button class="opt">Wrong answer</button>
  <p class="explain">Why the right answer is right.</p>
</div>
```
One or two quizzes per major section; test understanding, not trivia.

### Recap box (end of a subsection, optional)
```html
<div class="recap"><b>Takeaways</b><ul><li>…</li></ul></div>
```
