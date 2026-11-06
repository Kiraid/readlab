# Authoring guide — interactive chapter 12 (Ingress)

The site is `index.html` + `css/style.css` + `js/*.js`. Section content lives in
HTML fragments in `sections/`, loaded in order at runtime. Fragments are plain
HTML: **no `<script>`, no `<style>`, no `<html>/<body>`**. All behaviour comes
from the widget conventions below, which `js/app.js` wires up.

## Copyright — the most important rule

The source chapter is a copyrighted book. Read it for the concepts, then write
**everything in your own words**: no copied sentences, no lightly reworded
paragraphs, no distinctive phrases, no reproduced figure layouts or callout
text. Technical terms, field names, command names and standard kubectl output
formats are fine. Your prose should be a fresh, *shorter* explanation: mental
models, analogies, "why it matters", gotchas. Design your own diagrams of the
same ideas rather than redrawing the book's figures.

## Structure

Flat sequence of sections (no nesting across files):

```html
<section class="major" id="s12-2">
  <h2><span class="num">12.2</span> Creating and using Ingress objects</h2>
  <p>short intro…</p>
</section>
<section class="sub" id="s12-2-1">
  <h3><span class="num">12.2.1</span> Exposing a service through an Ingress</h3>
  …content…
</section>
```

Inside a section use `<p>`, `<ul>/<ol>`, `<h4>` for small headings, `<code>`,
`<kbd>`, `<dfn>`, `<table class="grid">`. Aim for ~150–350 words of prose per
subsection, broken up by visuals and widgets. Tone: a sharp friend explaining it
at a whiteboard. Short paragraphs.

## Widgets

### Callouts
```html
<aside class="callout note"><b>Note</b> text</aside>   <!-- also: tip, warn -->
```

### Manifests from the virtual directory (preferred over pasting YAML)
`js/files.js` defines the files. Read it to know what each contains.
```html
<div class="code" data-src="ing.kiada.yaml" data-hl="9-15,20"></div>
```
`data-hl` = 1-based line numbers to highlight (optional). Explain the
highlighted lines in the prose around it.

Other snippets (not from files): HTML-escape the content.
```html
<pre class="snippet" data-lang="yaml">status:
  loadBalancer: …</pre>
```

### Fake terminal (shared cluster state across the whole page)
```html
<div class="term" data-catchup="12.2.1">
  <code class="cmd">kubectl apply -f ing.kiada-example-com.yaml</code>
  <code class="cmd">kubectl get ing</code>
</div>
```
Each `<code class="cmd">` becomes a clickable chip (click = typed + run). The
reader can also type freely. `data-catchup="X"` adds a "Catch up" button that
puts the cluster in the state the reader would have *before* section X (all
earlier steps done). Escape `&`, `<`, `>` in commands. Use 2–6 chips per
terminal, in a sensible order. Only use commands from the list below (or the
same grammar with other hosts/paths, e.g. any `curl` URL works and is routed by
the real Ingress-matching logic against the current state).

**Prompt context:** user is in `~/Chapter12`, namespace `kiada`. Ingress IP is
`11.22.33.44`. Hosts: `kiada.example.com`, `api.example.com`. Pods: kiada-001..003,
quote-001..003, quiz, fun404 (after applied). Controller: ingress-nginx.

Supported commands:
- `help`, `clear`, `ls`, `ls SETUP`, `cat <file>`, `cat /etc/hosts`, `history`, `reset`, `catchup <section>`
- `kubectl get pods|svc|ing|ingressclasses|secrets|endpointslices [name] [-n ns|-A] [-o yaml|wide]`
- `kubectl describe ing <name>`
- `kubectl apply -f <file>` (any file in files.js; `aws.ingressclass.yaml` and `gke.backendconfig.yaml` fail with "no matches for kind" — that's intentional, the CRDs only exist on AWS/GKE)
- `kubectl apply -f SETUP/ --recursive`
- `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml` (installs the controller)
- `minikube addons enable ingress` (also installs it), `minikube ip`
- `kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=90s`
- `kubectl get pods -n ingress-nginx`, `kubectl get svc -n ingress-nginx`
- `kubectl logs -n ingress-nginx deploy/ingress-nginx-controller` (shows reloads per Ingress change)
- `kubectl delete ing <name> [<name>...]`, `kubectl delete -f <file>`
- `kubectl create secret tls tls-example-com --cert=example.crt --key=example.key`
- `kubectl explain ingress.spec`
- `openssl req -x509 -newkey rsa:2048 -keyout example.key -out example.crt -sha256 -days 7300 -nodes -subj '/CN=*.example.com' -addext 'subjectAltName = DNS:*.example.com'`
- `echo "11.22.33.44 kiada.example.com api.example.com" | sudo tee -a /etc/hosts`
- `nslookup <host>`
- `curl [-v] [-k] [-I] [-H "Cookie: SESSION_COOKIE=…"] [--resolve host:port:ip] <url>`
  Behaviour: no controller → connection refused; host unresolvable (no
  `--resolve`, not in /etc/hosts) → "Could not resolve host"; `curl http://11.22.33.44`
  → no Host match → default backend / nginx 404; Exact `/quote` vs `/quote/`;
  https without a TLS Secret → fake controller cert; `-k` needed for the
  self-signed cert; `-I` shows `Set-Cookie` once affinity annotations are on.

### Step-through diagram
```html
<figure class="diagram stepper">
  <svg viewBox="0 0 760 300" role="img" aria-label="…">
    … elements with data-step="1", data-step="2" … (unstepped = always visible)
  </svg>
  <ol class="steps"><li>step 1 text</li><li>step 2 text</li></ol>
  <figcaption><b>Figure</b> caption</figcaption>
</figure>
```
Prev/Next/Play controls are added automatically. Elements with
`data-step="n"` are dimmed until step n, highlighted at step n.

### Plain diagram
```html
<figure class="diagram">
  <svg viewBox="0 0 760 320" role="img" aria-label="…">…</svg>
  <figcaption><b>Figure</b> caption</figcaption>
</figure>
```
SVG rules: dark theme. **Use only these classes for colour** (no hex colours):
- node boxes (`<rect rx="10">`): `n-client`, `n-dns`, `n-ingress` (Ingress object),
  `n-proxy` (reverse proxy / L7 LB), `n-ctrl` (controller), `n-api` (API server /
  generic k8s object), `n-svc`, `n-pod`, `n-secret`, `n-default` (default backend / 404),
  `n-lb` (L4 cloud load balancer), `n-zone` (dashed group/cluster boundary)
- text: `lbl` (13px), `lbl-b` (bold), `lbl-sm` (11px muted), `lbl-mono` (monospace),
  `lbl-xs` (10px). Add `t-<role>` to colour text by role: `t-client`, `t-proxy`,
  `t-ctrl`, `t-svc`, `t-pod`, `t-api`, `t-secret`, `t-default`, `t-muted`
- lines: `edge` (plain arrow line), `edge-dim`, `flow` (animated marching dashes),
  `flow-tls` (pink animated), `flow-bad` (red animated). Arrowheads: put
  `marker-end="url(#arrow)"` (or `#arrow-tls`, `#arrow-bad`) — the markers are
  defined once globally in index.html, do NOT define your own.
- moving packet: `<circle class="packet" r="5"><animateMotion dur="2.4s" repeatCount="indefinite" path="M…"/></circle>`
  (`packet-tls`, `packet-bad` variants)
- `badge` rect + `badge-t` text for small pills (e.g. "L7", "TLS").
Use `text-anchor="middle"` and keep text ≥ 11px at viewBox width 760. Lay out
generously; diagrams scale to the column width (~760px). Make them good —
these are a highlight of the page.

### Tabs (e.g. compare two approaches)
```html
<div class="tabset">
  <div class="tabs"><button data-tab="a">Termination</button><button data-tab="b">Passthrough</button></div>
  <div class="tab-panel" data-tab="a">…</div>
  <div class="tab-panel" data-tab="b">…</div>
</div>
```

### Built-in interactive widgets (place the empty div; the JS fills it)
- `<div class="widget path-matcher"></div>` — Exact / Prefix path matching lab
- `<div class="widget host-matcher"></div>` — exact vs wildcard host lab
- `<div class="widget router-playground"></div>` — send a request through the
  full kiada Ingress and watch which backend gets it
- `<div class="widget lb-vs-ingress"></div>` — cost of N LoadBalancers vs 1 Ingress slider

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

### Recap box (end of a subsection, optional)
```html
<div class="recap"><b>Takeaways</b><ul><li>…</li></ul></div>
```
