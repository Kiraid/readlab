// Simulated cluster + shell. Shared by every terminal on the page.
(function () {
  const IP = '11.22.33.44';
  const NS = 'kiada';
  const READY_MS = 12000;      // controller pod becomes Ready this long after install
  const SYNC_MS = 2500;        // Ingress gets its address this long after creation
  const PROXY_POD_IP = '10.244.0.7';
  const CLIENT_IP = '172.18.0.1';
  const CTRL_POD = 'ingress-nginx-controller-6b9c8d7f5d-x2kqp';
  const KEY = 'kia12-state-v1';
  const listeners = new Set();
  let S;

  const BASE_PODS = {
    'kiada-001': { ip: '10.244.1.12', app: 'kiada', node: 'kind-worker' },
    'kiada-002': { ip: '10.244.2.8', app: 'kiada', node: 'kind-worker2' },
    'kiada-003': { ip: '10.244.1.13', app: 'kiada', node: 'kind-worker' },
    'quote-001': { ip: '10.244.2.9', app: 'quote', node: 'kind-worker2' },
    'quote-002': { ip: '10.244.1.14', app: 'quote', node: 'kind-worker' },
    'quote-003': { ip: '10.244.2.10', app: 'quote', node: 'kind-worker2' },
    'quiz': { ip: '10.244.1.15', app: 'quiz', node: 'kind-worker' },
  };
  const FUN404_POD = { ip: '10.244.2.11', app: 'fun404', node: 'kind-worker2' };
  const BASE_SVCS = {
    kiada: { clusterIP: '10.96.172.41', selector: 'kiada', ports: [{ name: 'http', port: 80, targetPort: 8080 }, { name: 'https', port: 443, targetPort: 8443 }] },
    quote: { clusterIP: '10.96.21.120', selector: 'quote', ports: [{ name: 'http', port: 80, targetPort: 80 }] },
    quiz: { clusterIP: '10.96.94.233', selector: 'quiz', ports: [{ name: 'http', port: 80, targetPort: 8080 }] },
  };
  const FUN404_SVC = { clusterIP: '10.96.140.4', selector: 'fun404', ports: [{ name: 'http', port: 80, targetPort: 8080 }] };

  function fresh() {
    const t = Date.now() - 2 * 86400e3 - 3 * 3600e3;
    const pods = {}, services = {};
    for (const [k, v] of Object.entries(BASE_PODS)) pods[k] = { ...v, created: t };
    for (const [k, v] of Object.entries(BASE_SVCS)) services[k] = { ...v, created: t };
    return {
      controller: null, ingresses: {}, pods, services, secrets: {}, files: [], hosts: [],
      ingressClasses: {}, log: [], rr: {}, history: [], certAt: null, fun404Text: null,
    };
  }
  function load() {
    try { const j = localStorage.getItem(KEY); if (j) { S = JSON.parse(j); return; } } catch (e) { /* ignore */ }
    S = fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
    listeners.forEach((f) => { try { f(S); } catch (e) { console.error(e); } });
  }
  load();

  // ---------- helpers ----------
  const now = () => Date.now();
  function age(t) {
    const s = Math.max(0, Math.floor((now() - t) / 1000));
    if (s < 120) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 10) return m + 'm' + (s % 60) + 's';
    const h = Math.floor(m / 60);
    if (h < 3) return m + 'm';
    if (h < 8) return h + 'h' + (m % 60) + 'm';
    const d = Math.floor(h / 24);
    if (h < 48) return h + 'h';
    if (d < 8) return d + 'd' + (h % 24) + 'h';
    return d + 'd';
  }
  function table(headers, rows) {
    const all = [headers, ...rows];
    const w = headers.map((_, c) => Math.max(...all.map((r) => String(r[c] ?? '').length)));
    return all.map((r) => r.map((v, c) => c === r.length - 1 ? String(v ?? '') : String(v ?? '').padEnd(w[c] + 3)).join('').replace(/\s+$/, '')).join('\n');
  }
  function hash(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  const pad2 = (n) => String(n).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function klogTs(t = now()) {
    const d = new Date(t);
    return `I${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}412`;
  }
  function accessTs(t = now()) {
    const d = new Date(t);
    return `${pad2(d.getUTCDate())}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} +0000`;
  }
  function certDate(t) {
    const d = new Date(t);
    return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`;
  }
  function httpDate() { return new Date().toUTCString(); }
  function ctrlLog(msg, t) { S.log.push(`${klogTs(t)}       7 ${msg}`); if (S.log.length > 400) S.log.splice(0, 100); }

  const controllerInstalled = () => !!S.controller;
  const controllerReady = () => !!S.controller && now() - S.controller.at >= READY_MS;
  const defaultClass = () => Object.values(S.ingressClasses).find((c) => c.isDefault);

  function ingAddress(ing) {
    if (!controllerReady() || ing.cls !== 'nginx') return '';
    const t = Math.max(ing.created, S.controller.at + READY_MS);
    return now() - t >= SYNC_MS ? IP : '';
  }
  function liveViews() {
    if (!controllerReady()) return [];
    return Object.values(S.ingresses).filter((i) => i.cls === 'nginx').sort((a, b) => a.created - b.created)
      .map((i) => ({ name: i.name, spec: i.spec, annotations: i.annotations || {} }));
  }
  function endpoints(svcName, env) {
    const svc = env.services[svcName];
    if (!svc) return null;
    return Object.entries(env.pods).filter(([, p]) => p.app === svc.selector).map(([name, p]) => ({ name, ...p }));
  }

  // ---------- matching ----------
  function hostScore(ruleHost, reqHost) {
    if (!ruleHost) return 0;
    reqHost = (reqHost || '').toLowerCase();
    if (ruleHost === reqHost) return 2;
    if (ruleHost.startsWith('*.')) {
      const parts = reqHost.split('.');
      if (parts.length >= 2 && parts[0] && parts.slice(1).join('.') === ruleHost.slice(2)) return 1;
    }
    return -1;
  }
  function splitPath(p) { return (p || '/').split('/').filter(Boolean); }
  function pathScore(type, rulePath, reqPath) {
    rulePath = rulePath || '/';
    if (type === 'Exact') return rulePath === reqPath ? 10000 + rulePath.length : -1;
    const r = splitPath(rulePath), q = splitPath(reqPath);
    if (r.length > q.length) return -1;
    for (let i = 0; i < r.length; i++) if (r[i] !== q[i]) return -1;
    return r.length;
  }
  function route(views, host, path) {
    let bestHs = -1;
    for (const v of views) for (const rule of v.spec.rules || []) bestHs = Math.max(bestHs, hostScore(rule.host, host));
    let best = null;
    if (bestHs >= 0) {
      for (const v of views) for (const rule of v.spec.rules || []) {
        if (hostScore(rule.host, host) !== bestHs) continue;
        for (const p of (rule.http && rule.http.paths) || []) {
          const ps = pathScore(p.pathType, p.path, path);
          if (ps >= 0 && (!best || ps > best.ps)) best = { ps, view: v, rule, p };
        }
      }
    }
    if (best) return { kind: 'rule', view: best.view, rule: best.rule, path: best.p, backend: best.p.backend, hostScore: bestHs };
    const d = views.find((v) => v.spec.defaultBackend);
    if (d) return { kind: 'default', view: d, backend: d.spec.defaultBackend, hostMatched: bestHs >= 0 };
    return { kind: 'none', hostMatched: bestHs >= 0 };
  }
  function certFor(host, env) {
    for (const v of env.views) for (const t of v.spec.tls || []) {
      if ((t.hosts || []).some((h) => hostScore(h, host) > 0) && env.secrets[t.secretName]) return { fake: false, secret: t.secretName };
    }
    return { fake: true };
  }

  // ---------- backend responses ----------
  const QUOTES = [
    'A Service gives pods one address. An Ingress gives Services one front door.',
    "If it isn't in the Host header, the Ingress never heard of it.",
    'Exact means exact. A trailing slash is a different path.',
    'Terminate TLS at the edge: locked outside, simple inside.',
    "A wildcard covers one label. *.example.com won't catch foo.kiada.example.com.",
    'Every 404 deserves a backend with a sense of humour.',
    'Annotations: where portable YAML goes to become vendor-specific.',
    'One IP, many hosts. Virtual hosting has been saving money since the nineties.',
  ];
  const QUESTIONS = [
    { text: 'Rule path /foo, pathType Prefix. Does /foobar match?', answers: ['Yes', 'No'], correctAnswerIndex: 1 },
    { text: 'Which component rewrites the proxy config when an Ingress changes?', answers: ['kube-proxy', 'The ingress controller', 'The API server'], correctAnswerIndex: 1 },
    { text: 'Rule host *.example.com. Does foo.kiada.example.com match?', answers: ['Yes', 'No'], correctAnswerIndex: 1 },
    { text: 'Where does the proxy usually send the request?', answers: ['The Service ClusterIP', 'Straight to a pod IP'], correctAnswerIndex: 1 },
    { text: 'Which spec field holds the catch-all backend?', answers: ['spec.fallback', 'spec.defaultBackend', 'spec.rules[0]'], correctAnswerIndex: 1 },
  ];
  const nginxPage = (code, msg) => `<html>\n<head><title>${code} ${msg}</title></head>\n<body>\n<center><h1>${code} ${msg}</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>`;

  function serve(backend, req, route, env, sideEffects) {
    const view = route.view;
    if (backend.resource) return { status: 503, statusText: 'Service Temporarily Unavailable', body: nginxPage(503, 'Service Temporarily Unavailable'), upstream: 'resource backend not supported by ingress-nginx' };
    const svcName = backend.service.name;
    const portRef = backend.service.port || {};
    const svc = env.services[svcName];
    if (!svc) return { status: 503, statusText: 'Service Temporarily Unavailable', body: nginxPage(503, 'Service Temporarily Unavailable'), svcName, problem: `Service "${svcName}" does not exist` };
    const port = svc.ports.find((p) => (portRef.name ? p.name === portRef.name : p.port === portRef.number));
    if (!port) return { status: 503, statusText: 'Service Temporarily Unavailable', body: nginxPage(503, 'Service Temporarily Unavailable'), svcName, problem: `Service "${svcName}" has no port ${portRef.name || portRef.number}` };
    const eps = endpoints(svcName, env);
    if (!eps.length) return { status: 503, statusText: 'Service Temporarily Unavailable', body: nginxPage(503, 'Service Temporarily Unavailable'), svcName, problem: `Service "${svcName}" has no ready endpoints` };

    const ann = (view && view.annotations) || {};
    const headers = [];
    let pod;
    const affinity = ann['nginx.ingress.kubernetes.io/affinity'] === 'cookie';
    const cookieName = ann['nginx.ingress.kubernetes.io/session-cookie-name'] || 'INGRESSCOOKIE';
    if (affinity) {
      const c = (req.cookie || '').split(/;\s*/).map((kv) => kv.split('=')).find(([k]) => k === cookieName);
      if (c && c[1]) pod = eps[hash(c[1]) % eps.length];
      else {
        const val = String(Math.floor(now() / 1000));
        pod = eps[hash(val) % eps.length];
        headers.push(['Set-Cookie', `${cookieName}=${val}; Path=/; HttpOnly`]);
      }
    } else {
      const rr = env.rr;
      rr[svcName] = ((rr[svcName] ?? -1) + 1) % eps.length;
      pod = eps[rr[svcName]];
    }
    const upstream = `${NS}-${svcName}-${port.name || port.port}`;
    const podAddr = `${pod.ip}:${port.targetPort}`;
    const base = { svcName, port, pod, upstream, podAddr, headers };

    if (port.targetPort === 8443) {
      return { ...base, status: 400, statusText: 'Bad Request', ctype: 'text/html', body: '<html>\n<head><title>400 The plain HTTP request was sent to HTTPS port</title></head>\n<body>\n<center><h1>400 Bad Request</h1></center>\n<center>The plain HTTP request was sent to HTTPS port</center>\n</body>\n</html>' };
    }
    if (svc.selector === 'kiada') {
      const body = [
        'Kiada 0.5 says hi!',
        '------------------------------------------------------------',
        `pod      ${pod.name}   (${pod.ip}, node ${pod.node})`,
        `request  ${req.method || 'GET'} ${req.path} HTTP/1.1`,
        `host     ${req.host}`,
        `from     ${PROXY_POD_IP}   <- the ingress proxy pod, not your machine`,
        `X-Forwarded-For:   ${CLIENT_IP}   (the real client)`,
        `X-Forwarded-Proto: ${req.scheme}${req.scheme === 'https' ? '   (TLS ended at the proxy; this pod got plain HTTP)' : ''}`,
        '------------------------------------------------------------',
      ].join('\n');
      return { ...base, status: 200, statusText: 'OK', ctype: 'text/plain', body };
    }
    if (svc.selector === 'quote') {
      const q = QUOTES[(hash(pod.name) + (env.rr.__q = (env.rr.__q || 0) + 1)) % QUOTES.length];
      return { ...base, status: 200, statusText: 'OK', ctype: 'text/plain', body: `"${q}"\n   - quote service, pod ${pod.name}` };
    }
    if (svc.selector === 'quiz') {
      const i = (env.rr.__z = ((env.rr.__z ?? -1) + 1)) % QUESTIONS.length;
      return { ...base, status: 200, statusText: 'OK', ctype: 'application/json', body: JSON.stringify({ id: i + 1, ...QUESTIONS[i], servedBy: pod.name }, null, 2) };
    }
    if (svc.selector === 'fun404') {
      return { ...base, status: 404, statusText: 'Not Found', ctype: 'text/plain', body: env.fun404Text || '404 - nothing lives at this address. Try another door.' };
    }
    return { ...base, status: 200, statusText: 'OK', ctype: 'text/plain', body: 'ok' };
  }

  // env = what the request sees. live: from S. book: final chapter Ingress, everything deployed.
  function liveEnv() {
    return { views: liveViews(), services: S.services, pods: S.pods, secrets: S.secrets, rr: S.rr, ready: controllerReady(), fun404Text: S.fun404Text };
  }
  let bookEnvCache = null;
  function bookEnv() {
    if (!bookEnvCache) {
      const [ing] = YAML.parseAll(FILES['ing.kiada.tls.yaml']);
      bookEnvCache = {
        views: [{ name: 'kiada', spec: ing.spec, annotations: {} }],
        services: { ...BASE_SVCS, fun404: FUN404_SVC },
        pods: { ...BASE_PODS, fun404: FUN404_POD },
        secrets: { 'tls-example-com': {} }, rr: {}, ready: true,
      };
    }
    return bookEnvCache;
  }

  // Full request through the proxy (after DNS/TCP/TLS). Returns route + response.
  function request(req, env, sideEffects = true) {
    const r = route(env.views, req.host, req.path);
    let resp;
    if (r.kind === 'none') resp = { status: 404, statusText: 'Not Found', ctype: 'text/html', body: nginxPage(404, 'Not Found'), upstream: 'upstream-default-backend', podAddr: '127.0.0.1:8181' };
    else resp = serve(r.backend, req, r, env, sideEffects);
    if (sideEffects) {
      const len = resp.body.length;
      S.log.push(`${CLIENT_IP} - - [${accessTs()}] "${req.method || 'GET'} ${req.path} HTTP/${req.scheme === 'https' ? '2.0' : '1.1'}" ${resp.status} ${len} "-" "curl/8.5.0" ${60 + req.path.length + req.host.length} 0.00${1 + (hash(req.path) % 8)} [${resp.upstream || '-'}] [] ${resp.podAddr || '-'} ${len} 0.002 ${resp.status} ${hash(now()).toString(16).padStart(8, '0')}${hash(req.path).toString(16).padStart(8, '0')}`);
    }
    return { route: r, resp };
  }

  // ---------- applying manifests ----------
  function webhookErr(file) {
    return `Error from server (InternalError): error when creating "${file}": Internal error occurred: failed calling webhook "validate.nginx.ingress.kubernetes.io": failed to call webhook: Post "https://ingress-nginx-controller-admission.ingress-nginx.svc:443/networking/v1/ingresses?timeout=10s": dial tcp 10.96.88.12:443: connect: connection refused`;
  }
  function conflictFor(name, spec) {
    for (const other of Object.values(S.ingresses)) {
      if (other.name === name || other.cls !== 'nginx') continue;
      for (const r1 of spec.rules || []) for (const p1 of (r1.http && r1.http.paths) || [])
        for (const r2 of other.spec.rules || []) for (const p2 of (r2.http && r2.http.paths) || [])
          if ((r1.host || '') === (r2.host || '') && (p1.path || '/') === (p2.path || '/')) return { host: r1.host || '*', path: p1.path || '/', other: other.name };
    }
    return null;
  }

  function applyDoc(doc, file, opts = {}) {
    const kind = doc.kind, name = doc.metadata && doc.metadata.name;
    const t = opts.at || now();
    if (kind === 'Ingress') {
      const spec = JSON.parse(JSON.stringify(doc.spec || {}));
      const existing = S.ingresses[name];
      if (controllerInstalled() && !controllerReady() && !opts.silent) return { err: webhookErr(file) };
      let cls = spec.ingressClassName || (existing && existing.cls) || null;
      if (!spec.ingressClassName && !existing) { const d = defaultClass(); if (d) { cls = d.name; } }
      if (cls === 'nginx' && controllerReady()) {
        const c = conflictFor(name, spec);
        if (c) return { err: `Error from server (BadRequest): error when ${existing ? 'applying patch' : 'creating'} "${file}": admission webhook "validate.nginx.ingress.kubernetes.io" denied the request: host "${c.host}" and path "${c.path}" is already defined in ingress ${NS}/${c.other}`, hint: `ingress-nginx refuses two Ingresses claiming the same host+path. Delete the old one first: kubectl delete ing ${c.other}` };
      }
      const annotations = (doc.metadata && doc.metadata.annotations) || {};
      if (existing) {
        const same = JSON.stringify(existing.spec) === JSON.stringify(spec) && JSON.stringify(existing.annotations || {}) === JSON.stringify(annotations);
        if (same) return { msg: `ingress.networking.k8s.io/${name} unchanged` };
        Object.assign(existing, { spec, annotations, gen: existing.gen + 1, cls, updated: t, syncs: (existing.syncs || 1) + 1 });
      } else {
        S.ingresses[name] = { name, spec, annotations, created: t, updated: t, gen: 1, cls, syncs: 1, rv: 10000 + Math.floor(Math.random() * 90000) };
      }
      if (controllerReady() && cls === 'nginx') {
        ctrlLog(`store.go:440] "Found valid IngressClass" ingress="${NS}/${name}" ingressclass="nginx"`, t);
        ctrlLog(`event.go:377] Event(v1.ObjectReference{Kind:"Ingress", Namespace:"${NS}", Name:"${name}"}): type: 'Normal' reason: 'Sync' Scheduled for sync`, t);
        if (annotations['nginx.ingress.kubernetes.io/ssl-passthrough'] === 'true') ctrlLog(`W  annotations.go:151] "ssl-passthrough annotation ignored: controller was not started with --enable-ssl-passthrough" ingress="${NS}/${name}"`, t);
        for (const tl of spec.tls || []) if (!S.secrets[tl.secretName]) ctrlLog(`W  backend_ssl.go:47] Error obtaining X.509 certificate: no object matching key "${NS}/${tl.secretName}" in local store`, t);
        ctrlLog('controller.go:190] "Configuration changes detected, backend reload required"', t + 120);
        ctrlLog('controller.go:210] "Backend successfully reloaded"', t + 380);
      }
      return { msg: `ingress.networking.k8s.io/${name} ${existing ? 'configured' : 'created'}`, ing: S.ingresses[name] };
    }
    if (kind === 'Service') {
      if (name === 'fun404') {
        if (S.services.fun404) return { msg: 'service/fun404 unchanged' };
        S.services.fun404 = { ...FUN404_SVC, created: t };
        return { msg: 'service/fun404 created' };
      }
      if (S.services[name]) {
        const ann = doc.metadata.annotations;
        if (ann && JSON.stringify(ann) !== JSON.stringify(S.services[name].annotations || null)) { S.services[name].annotations = ann; return { msg: `service/${name} configured` }; }
        return { msg: `service/${name} unchanged` };
      }
      return { msg: `service/${name} created` };
    }
    if (kind === 'Pod') {
      if (name === 'fun404') {
        if (S.pods.fun404) return { msg: 'pod/fun404 unchanged' };
        S.pods.fun404 = { ...FUN404_POD, created: t };
        const txt = ((doc.spec.containers[0].args || []).find((a) => a.startsWith('--text=')) || '').slice(7);
        if (txt) S.fun404Text = txt;
        return { msg: 'pod/fun404 created' };
      }
      return { msg: `pod/${name} unchanged` };
    }
    if (kind === 'IngressClass') {
      if (S.ingressClasses[name]) return { msg: `ingressclass.networking.k8s.io/${name} unchanged` };
      S.ingressClasses[name] = { name, controller: doc.spec.controller, params: doc.spec.parameters || null, created: t, isDefault: false };
      return { msg: `ingressclass.networking.k8s.io/${name} created` };
    }
    if (kind === 'BackendConfig' || kind === 'IngressClassParams') {
      return { err: `error: resource mapping not found for name: "${name}" namespace: "" from "${file}": no matches for kind "${kind}" in version "${doc.apiVersion}"\nensure CRDs are installed first`, hint: kind === 'BackendConfig' ? 'BackendConfig is a CRD that only exists on GKE clusters. This is a kind cluster, so the API server has never heard of it.' : 'IngressClassParams is a CRD installed with the AWS Load Balancer Controller. No such CRD here, so the API server rejects it.' };
    }
    return { msg: `${kind.toLowerCase()}/${name} unchanged` };
  }

  function installController(t = now()) {
    S.controller = { at: t };
    S.ingressClasses.nginx = { name: 'nginx', controller: 'k8s.io/ingress-nginx', params: null, created: t, isDefault: true };
    S.log = [];
    ctrlLog('main.go:205] "Creating API client" host="https://10.96.0.1:443"', t + 4000);
    ctrlLog('main.go:248] "Running in Kubernetes cluster" major="1" minor="31" git="v1.31.0" state="clean" platform="linux/amd64"', t + 4100);
    ctrlLog('main.go:101] "SSL fake certificate created" file="/etc/ingress-controller/ssl/default-fake-certificate.pem"', t + 5200);
    ctrlLog('nginx.go:271] "Starting NGINX Ingress controller"', t + 6000);
    ctrlLog('controller.go:190] "Configuration changes detected, backend reload required"', t + 9000);
    ctrlLog('controller.go:210] "Backend successfully reloaded"', t + 9800);
    ctrlLog('leaderelection.go:271] successfully acquired lease ingress-nginx/ingress-nginx-leader', t + 11000);
    ctrlLog('status.go:85] "New leader elected" identity="' + CTRL_POD + '"', t + 11500);
  }

  // ---------- catch-up ----------
  const ORDER = ['12', '12.1', '12.1.1', '12.1.2', '12.1.3', '12.2', '12.2.1', '12.2.2', '12.2.3', '12.2.4', '12.3', '12.3.1', '12.3.2', '12.4', '12.4.1', '12.4.2', '12.5', '12.5.1', '12.5.2', '12.5.3', '12.6', '12.7'];
  function catchup(section, ctx) {
    const idx = ORDER.indexOf(section);
    if (idx < 0) { ctx.err(`catchup: unknown section "${section}". Try one of: ${ORDER.slice(4).join(' ')}`); return; }
    const keepHistory = S.history;
    S = fresh(); S.history = keepHistory;
    const t0 = now() - 30 * 60e3;
    const done = [];
    const at = (n) => idx >= ORDER.indexOf(n);
    const apply = (file, mins) => { for (const d of YAML.parseAll(FILES[file])) applyDoc(d, file, { silent: true, at: t0 + mins * 60e3 }); done.push(`kubectl apply -f ${file}`); };
    if (at('12.2')) { installController(t0); done.push('installed ingress-nginx (kind deploy.yaml)'); }
    if (at('12.2.2')) { apply('ing.kiada-example-com.yaml', 2); S.hosts.push(`${IP} kiada.example.com api.example.com`); done.push('added kiada.example.com + api.example.com to /etc/hosts'); }
    if (at('12.2.3')) apply('ing.api-example-com.yaml', 4);
    if (at('12.2.4')) { delete S.ingresses['kiada-example-com']; delete S.ingresses['api-example-com']; done.push('kubectl delete ing kiada-example-com api-example-com'); apply('ing.kiada.yaml', 6); }
    if (at('12.3')) { apply('all.fun404.yaml', 8); apply('ing.kiada.defaultBackend.yaml', 9); }
    if (at('12.4')) {
      S.files.push('example.key', 'example.crt'); S.certAt = t0 + 11 * 60e3; done.push('openssl req ... (example.key + example.crt)');
      S.secrets['tls-example-com'] = { type: 'kubernetes.io/tls', created: t0 + 12 * 60e3 }; done.push('kubectl create secret tls tls-example-com ...');
      apply('ing.kiada.tls.yaml', 13);
    }
    if (at('12.4.2')) apply('ing.kiada.nginx-affinity.yaml', 15);
    if (!done.length) done.push('fresh cluster: kiada, quote and quiz deployed; no ingress controller yet');
    S.log.push(...[]);
    save();
    ctx.ok(`Cluster fast-forwarded to the start of ${section}:`);
    done.forEach((d) => ctx.out('  ✔ ' + d, 'dim'));
  }

  // ---------- shell ----------
  function tokenize(line) {
    const out = []; let cur = '', q = null, has = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === q) q = null; else cur += c; continue; }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
      if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
      cur += c;
    }
    if (cur || has) out.push(cur);
    return out;
  }
  function flags(argv, spec) {
    // spec: {'-n': 'ns', '--namespace': 'ns', '-o': 'out', ...} value flags; bool flags listed in spec.bool
    const pos = [], f = {};
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      const eq = a.indexOf('=');
      const k = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
      if (spec.val[k]) { f[spec.val[k]] = eq > 0 && a.startsWith('--') ? a.slice(eq + 1) : argv[++i]; continue; }
      if (/^-o\w/.test(a) && spec.val['-o']) { f.out = a.slice(2); continue; }
      if (spec.bool[k]) { f[spec.bool[k]] = true; continue; }
      if (a.startsWith('-') && a.length > 1) { f._unknown = (f._unknown || []).concat(a); continue; }
      pos.push(a);
    }
    return { pos, f };
  }
  const RES = {
    po: 'pods', pod: 'pods', pods: 'pods', svc: 'services', service: 'services', services: 'services',
    ing: 'ingresses', ingress: 'ingresses', ingresses: 'ingresses', ingressclass: 'ingressclasses', ingressclasses: 'ingressclasses',
    secret: 'secrets', secrets: 'secrets', endpointslice: 'endpointslices', endpointslices: 'endpointslices', ep: 'endpointslices', endpoints: 'endpointslices',
    ns: 'namespaces', namespace: 'namespaces', namespaces: 'namespaces', no: 'nodes', node: 'nodes', nodes: 'nodes',
  };

  function ingYaml(ing) {
    const hx = (s, n) => hash(s).toString(16).padStart(8, '0').repeat(2).slice(0, n);
    const md = {};
    if (ing.annotations && Object.keys(ing.annotations).length) md.annotations = ing.annotations;
    Object.assign(md, { creationTimestamp: new Date(ing.created).toISOString().replace(/\.\d+Z$/, 'Z'), generation: ing.gen, name: ing.name, namespace: NS, resourceVersion: String(ing.rv + ing.gen), uid: `${hx(ing.name, 8)}-${hx(ing.name + 1, 4)}-4${hx(ing.name + 2, 3)}-9${hx(ing.name + 3, 3)}-${hx(ing.name + 4, 12)}` });
    const spec = {};
    if (ing.spec.defaultBackend) spec.defaultBackend = ing.spec.defaultBackend;
    if (ing.cls) spec.ingressClassName = ing.cls;
    if (ing.spec.rules) spec.rules = ing.spec.rules;
    if (ing.spec.tls) spec.tls = ing.spec.tls;
    const addr = ingAddress(ing);
    const doc = { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: md, spec, status: { loadBalancer: addr ? { ingress: [{ ip: addr }] } : {} } };
    return YAML.stringify(doc);
  }
  function backendStr(b, env) {
    if (b.resource) return `APIGroup: ${b.resource.apiGroup}, Kind: ${b.resource.kind}, Name: ${b.resource.name}`;
    const s = b.service; const pr = s.port.name || s.port.number;
    const svc = S.services[s.name];
    if (!svc) return `${s.name}:${pr} (<error: services "${s.name}" not found>)`;
    const port = svc.ports.find((p) => (s.port.name ? p.name === s.port.name : p.port === s.port.number));
    const eps = endpoints(s.name, env || liveEnv());
    if (!port || !eps.length) return `${s.name}:${pr} (<error: endpoints "${s.name}" not found>)`;
    return `${s.name}:${pr} (${eps.map((e) => e.ip + ':' + port.targetPort).join(',')})`;
  }
  function describeIng(ing) {
    const L = [];
    const addr = ingAddress(ing);
    L.push(`Name:             ${ing.name}`);
    L.push('Labels:           <none>');
    L.push(`Namespace:        ${NS}`);
    L.push(`Address:          ${addr}`);
    L.push(`Ingress Class:    ${ing.cls || '<none>'}`);
    L.push(`Default backend:  ${ing.spec.defaultBackend ? backendStr(ing.spec.defaultBackend) : '<default>'}`);
    if (ing.spec.tls) { L.push('TLS:'); for (const t of ing.spec.tls) L.push(`  ${t.secretName} terminates ${(t.hosts || []).join(',')}`); }
    L.push('Rules:');
    const rows = [];
    for (const r of ing.spec.rules || []) {
      rows.push([r.host || '*', '', '']);
      for (const p of (r.http && r.http.paths) || []) rows.push(['', p.path || '', backendStr(p.backend)]);
    }
    const w0 = Math.max(4, ...rows.map((r) => r[0].length)) + 2, w1 = Math.max(4, ...rows.map((r) => r[1].length)) + 2;
    L.push(`  ${'Host'.padEnd(w0)}${'Path'.padEnd(w1)}Backends`);
    L.push(`  ${'----'.padEnd(w0)}${'----'.padEnd(w1)}--------`);
    for (const r of rows) L.push(('  ' + r[0].padEnd(w0) + r[1].padEnd(w1) + r[2]).replace(/\s+$/, ''));
    const ann = ing.annotations && Object.entries(ing.annotations);
    if (ann && ann.length) { L.push('Annotations:      ' + ann.map(([k, v]) => `${k}: ${v}`).join('\n                  ')); } else L.push('Annotations:      <none>');
    L.push('Events:');
    if (ing.cls === 'nginx' && controllerReady()) {
      const n = ing.syncs || 1;
      L.push('  Type    Reason  Age' + ' '.repeat(Math.max(3, 16)) + 'From                      Message');
      L.push('  ----    ------  ----' + ' '.repeat(15) + '----                      -------');
      const a = n > 1 ? `${age(ing.updated)} (x${n} over ${age(ing.created)})` : age(ing.created);
      L.push(`  Normal  Sync    ${a.padEnd(19)}nginx-ingress-controller  Scheduled for sync`);
    } else L.push('  <none>');
    return L.join('\n');
  }

  const help = `Simulated shell for chapter 12 · state is shared by every terminal on the page

  kubectl get pods|svc|ing|ingressclasses|secrets|endpointslices [-n ns|-A] [-o yaml|wide]
  kubectl describe ing <name>        kubectl apply -f <file>      kubectl delete ing <name>
  kubectl create secret tls ...      kubectl explain ingress.spec kubectl logs -n ingress-nginx deploy/ingress-nginx-controller
  curl [-v] [-k] [-I] [-H "Cookie: ..."] [--resolve host:port:ip] <url>
  ls · cat <file> · cat /etc/hosts · openssl req ... · nslookup <host> · getent hosts <host>
  history · clear (Ctrl+L) · reset (fresh cluster) · catchup <section>, e.g. catchup 12.3

  Tab completes, ↑/↓ walks history, the \` key opens the drop-down shell.`;

  async function kubectl(argv, ctx) {
    const verb = argv[0];
    const { pos, f } = flags(argv.slice(1), {
      val: { '-n': 'ns', '--namespace': 'ns', '-o': 'out', '--output': 'out', '-f': 'file', '--filename': 'file', '--cert': 'cert', '--key': 'key', '--for': 'for', '--selector': 'sel', '-l': 'sel', '--timeout': 'timeout' },
      bool: { '-A': 'all', '--all-namespaces': 'all', '-R': 'rec', '--recursive': 'rec', '-w': 'watch', '--watch': 'watch' },
    });
    const ns = f.all ? '*' : (f.ns || NS);
    if (!verb) { ctx.out('kubectl controls the Kubernetes cluster manager.\n\nTry: kubectl get ing'); return; }

    if (verb === 'get') {
      let [res, name] = pos;
      if (!res) { ctx.err('You must specify the type of resource to get.'); return; }
      if (res.includes('/')) [res, name] = res.split('/');
      const kind = RES[res.toLowerCase()];
      if (!kind) { ctx.err(`error: the server doesn't have a resource type "${res}"`); return; }
      return getRes(kind, name, ns, f, ctx);
    }
    if (verb === 'describe') {
      let [res, name] = pos;
      if (res && res.includes('/')) [res, name] = res.split('/');
      const kind = RES[(res || '').toLowerCase()];
      if (kind !== 'ingresses') { ctx.out('(this simulator only describes Ingresses: kubectl describe ing <name>)', 'hint'); return; }
      const list = name ? [S.ingresses[name]] : Object.values(S.ingresses);
      if (name && !S.ingresses[name]) { ctx.err(`Error from server (NotFound): ingresses.networking.k8s.io "${name}" not found`); return; }
      if (!list.length) { ctx.out(`No resources found in ${NS} namespace.`); return; }
      ctx.out(list.map(describeIng).join('\n\n\n'));
      return;
    }
    if (verb === 'apply' || verb === 'create' && f.file) {
      const file = f.file;
      if (!file) { ctx.err('error: must specify one of -f and -k'); return; }
      if (/^https?:\/\//.test(file)) {
        if (/ingress-nginx/.test(file) && /deploy\.yaml$/.test(file)) {
          if (controllerInstalled()) {
            ctx.out(INSTALL_LINES.map((l) => l.replace('created', 'unchanged')).join('\n'));
            return;
          }
          for (const l of INSTALL_LINES) { ctx.out(l); await ctx.sleep(35); }
          installController();
          save();
          ctx.hint('The controller pod takes ~10s to become Ready. Watch it with: kubectl get pods -n ingress-nginx');
          return;
        }
        ctx.err(`error: unable to read URL "${file}", server reported 404 Not Found, status code=404`);
        return;
      }
      const clean = file.replace(/^\.\//, '').replace(/\/$/, '');
      if (clean === 'SETUP') {
        if (!f.rec) { /* files are at top level anyway */ }
        ctx.out(['namespace/kiada unchanged', ...['kiada-001', 'kiada-002', 'kiada-003', 'quote-001', 'quote-002', 'quote-003', 'quiz'].map((p) => `pod/${p} unchanged`), 'service/kiada unchanged', 'service/quote unchanged', 'service/quiz unchanged'].join('\n'));
        return;
      }
      if (!FILES[clean]) { ctx.err(`error: the path "${file}" does not exist`); return; }
      const docs = YAML.parseAll(FILES[clean]);
      const errs = [];
      for (const d of docs) {
        const r = applyDoc(d, clean);
        if (r.err) errs.push(r); else ctx.out(r.msg);
      }
      for (const e of errs) { ctx.err(e.err); if (e.hint) ctx.hint(e.hint); }
      save();
      const ing = docs.find((d) => d.kind === 'Ingress');
      if (ing && !errs.length) {
        const rec = S.ingresses[ing.metadata.name];
        if (!controllerInstalled()) ctx.hint('No ingress controller is installed, so nothing will act on this Ingress yet (section 12.1.3). It also got no class, because no default IngressClass exists.');
        else if (rec && rec.cls && rec.cls !== 'nginx') ctx.hint(`This Ingress has class "${rec.cls}". No installed controller handles that class, so it will never get an address.`);
      }
      return;
    }
    if (verb === 'delete') {
      if (f.file) {
        const clean = f.file.replace(/^\.\//, '');
        if (!FILES[clean]) { ctx.err(`error: the path "${f.file}" does not exist`); return; }
        for (const d of YAML.parseAll(FILES[clean])) {
          const n = d.metadata.name;
          if (d.kind === 'Ingress' && S.ingresses[n]) { delete S.ingresses[n]; ctx.out(`ingress.networking.k8s.io "${n}" deleted`); ctrlLog('controller.go:190] "Configuration changes detected, backend reload required"'); ctrlLog('controller.go:210] "Backend successfully reloaded"'); }
          else if (d.kind === 'Pod' && n === 'fun404' && S.pods.fun404) { delete S.pods.fun404; ctx.out('pod "fun404" deleted'); }
          else if (d.kind === 'Service' && n === 'fun404' && S.services.fun404) { delete S.services.fun404; ctx.out('service "fun404" deleted'); }
          else if (d.kind === 'IngressClass' && S.ingressClasses[n]) { delete S.ingressClasses[n]; ctx.out(`ingressclass.networking.k8s.io "${n}" deleted`); }
          else ctx.err(`Error from server (NotFound): error when deleting "${clean}": ${d.kind.toLowerCase()}s "${n}" not found`);
        }
        save(); return;
      }
      let [res, ...names] = pos;
      if (res && res.includes('/')) { names = [res.split('/')[1], ...names]; res = res.split('/')[0]; }
      const kind = RES[(res || '').toLowerCase()];
      if (!kind) { ctx.err('error: You must provide one or more resources by argument or filename.'); return; }
      if (!names.length) { ctx.err('error: resource(s) were provided, but no name was specified'); return; }
      for (const n of names) {
        if (kind === 'ingresses' && S.ingresses[n]) { delete S.ingresses[n]; ctx.out(`ingress.networking.k8s.io "${n}" deleted`); if (controllerReady()) { ctrlLog('controller.go:190] "Configuration changes detected, backend reload required"'); ctrlLog('controller.go:210] "Backend successfully reloaded"'); } }
        else if (kind === 'secrets' && S.secrets[n]) { delete S.secrets[n]; ctx.out(`secret "${n}" deleted`); }
        else if (kind === 'pods' && S.pods[n]) { ctx.out(`pod "${n}" deleted`); if (n === 'fun404') delete S.pods[n]; else ctx.hint('(in this simulator the kiada suite pods come straight back)'); }
        else ctx.err(`Error from server (NotFound): ${kind === 'ingresses' ? 'ingresses.networking.k8s.io' : kind} "${n}" not found`);
      }
      save(); return;
    }
    if (verb === 'create') {
      if (pos[0] === 'secret' && pos[1] === 'tls') {
        const name = pos[2];
        if (!name) { ctx.err('error: exactly one NAME is required, got 0'); return; }
        if (!f.cert || !f.key) { ctx.err('error: required flag(s) "cert", "key" not set'); return; }
        for (const fl of [f.cert, f.key]) if (!S.files.includes(fl)) { ctx.err(`error: open ${fl}: no such file or directory`); ctx.hint('Generate the key and certificate first with the openssl command.'); return; }
        if (S.secrets[name]) { ctx.err(`error: failed to create secret secrets "${name}" already exists`); return; }
        S.secrets[name] = { type: 'kubernetes.io/tls', created: now() };
        if (controllerReady() && Object.values(S.ingresses).some((i) => (i.spec.tls || []).some((t) => t.secretName === name))) { ctrlLog('controller.go:190] "Configuration changes detected, backend reload required"'); ctrlLog('controller.go:210] "Backend successfully reloaded"'); }
        save();
        ctx.out(`secret/${name} created`);
        return;
      }
      ctx.out('(this simulator supports: kubectl create secret tls <name> --cert=<file> --key=<file>)', 'hint');
      return;
    }
    if (verb === 'explain') {
      const what = (pos[0] || '').toLowerCase();
      if (/^(ingress|ingresses|ing)\.spec$/.test(what)) { ctx.out(EXPLAIN_SPEC); return; }
      if (/^(ingress|ingresses|ing)$/.test(what)) { ctx.out(EXPLAIN_ING); return; }
      if (/^backendconfig/.test(what)) { ctx.err(`error: couldn't find resource for "${what}"`); ctx.hint('BackendConfig only exists on GKE clusters.'); return; }
      ctx.out(`(try: kubectl explain ingress.spec)`, 'hint');
      return;
    }
    if (verb === 'logs') {
      const target = pos.join(' ');
      if (!/ingress-nginx-controller/.test(target)) { ctx.out('(try: kubectl logs -n ingress-nginx deploy/ingress-nginx-controller)', 'hint'); return; }
      if (!controllerInstalled()) { ctx.err('Error from server (NotFound): namespaces "ingress-nginx" not found'); return; }
      if (!controllerReady() && now() - S.controller.at < 4000) { ctx.err(`Error from server (BadRequest): container "controller" in pod "${CTRL_POD}" is waiting to start: ContainerCreating`); return; }
      const shown = S.log.filter((l) => !/^I\d{4} /.test(l) || true);
      ctx.out('-------------------------------------------------------------------------------\nNGINX Ingress controller\n  Release:       v1.11.3\n  Build:         0106de65cfccb74405a6dfa7d9daffc6f0a6ef1a\n  Repository:    https://github.com/kubernetes/ingress-nginx\n-------------------------------------------------------------------------------\n', 'dim');
      ctx.out(shown.slice(-60).join('\n'));
      ctx.hint('Access-log lines show [namespace-service-port] and the pod IP:port nginx forwarded to. Note: a pod IP, not the ClusterIP.');
      return;
    }
    if (verb === 'wait') {
      if (!controllerInstalled()) { ctx.err('error: no matching resources found'); return; }
      const left = READY_MS - (now() - S.controller.at);
      if (left > 0) await ctx.sleep(Math.min(left, 15000));
      ctx.out(`pod/${CTRL_POD} condition met`);
      return;
    }
    if (verb === 'edit') { ctx.out('(no editor in this simulator: edit the file and use kubectl apply -f instead)', 'hint'); return; }
    if (verb === 'version') { ctx.out('Client Version: v1.31.2\nKustomize Version: v5.4.2\nServer Version: v1.31.0'); return; }
    if (verb === 'config' || verb === 'cluster-info') { ctx.out('Kubernetes control plane is running at https://127.0.0.1:41237\nCoreDNS is running at https://127.0.0.1:41237/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy'); return; }
    ctx.err(`error: unknown command "${verb}" for "kubectl"`);
  }

  function getRes(kind, name, ns, f, ctx) {
    const nsLabel = ns === '*' ? '' : ns;
    const none = () => ctx.out(ns === '*' ? 'No resources found' : `No resources found in ${nsLabel} namespace.`);
    if (kind === 'ingresses') {
      if (ns !== NS && ns !== '*') return none();
      let list = Object.values(S.ingresses).sort((a, b) => a.created - b.created);
      if (name) { list = list.filter((i) => i.name === name); if (!list.length) { ctx.err(`Error from server (NotFound): ingresses.networking.k8s.io "${name}" not found`); return; } }
      if (f.out === 'yaml') { ctx.out(list.length === 1 ? ingYaml(list[0]) : 'apiVersion: v1\nitems:\n' + list.map((i) => '- ' + ingYaml(i).split('\n').join('\n  ')).join('\n') + '\nkind: List'); return; }
      if (!list.length) return none();
      const rows = list.map((i) => {
        const hosts = [...new Set((i.spec.rules || []).map((r) => r.host || '*'))].join(',') || '*';
        const row = [i.name, i.cls || '<none>', hosts, ingAddress(i), i.spec.tls ? '80, 443' : '80', age(i.created)];
        return ns === '*' ? [NS, ...row] : row;
      });
      ctx.out(table(ns === '*' ? ['NAMESPACE', 'NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE'] : ['NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE'], rows));
      if (list.some((i) => !ingAddress(i))) {
        if (!controllerInstalled()) ctx.hint('ADDRESS is empty: no ingress controller is running, so no proxy was provisioned.');
        else if (!controllerReady()) ctx.hint('ADDRESS is empty: the controller pod is still starting.');
        else if (list.some((i) => i.cls === 'nginx' && !ingAddress(i))) ctx.hint('ADDRESS not assigned yet: the controller syncs status every few seconds. Run it again.');
        else ctx.hint('An Ingress without an address has a class no running controller claims.');
      }
      return;
    }
    if (kind === 'ingressclasses') {
      let list = Object.values(S.ingressClasses);
      if (name) { list = list.filter((c) => c.name === name); if (!list.length) { ctx.err(`Error from server (NotFound): ingressclasses.networking.k8s.io "${name}" not found`); return; } }
      if (!list.length) { ctx.out('No resources found'); return; }
      if (f.out === 'yaml') {
        ctx.out(list.map((c) => {
          const md = {};
          if (c.isDefault) md.annotations = { 'ingressclass.kubernetes.io/is-default-class': 'true' };
          if (c.name === 'nginx') md.labels = { 'app.kubernetes.io/component': 'controller', 'app.kubernetes.io/instance': 'ingress-nginx', 'app.kubernetes.io/name': 'ingress-nginx' };
          md.name = c.name;
          const spec = { controller: c.controller };
          if (c.params) spec.parameters = c.params;
          return YAML.stringify({ apiVersion: 'networking.k8s.io/v1', kind: 'IngressClass', metadata: md, spec });
        }).join('\n---\n'));
        return;
      }
      ctx.out(table(['NAME', 'CONTROLLER', 'PARAMETERS', 'AGE'], list.map((c) => [c.name, c.controller, c.params ? `${c.params.kind}.${c.params.apiGroup}/${c.params.name}` : '<none>', age(c.created)])));
      return;
    }
    if (kind === 'pods') {
      if (ns === 'ingress-nginx' || (ns === '*' && controllerInstalled())) {
        if (!controllerInstalled()) return none();
        const el = now() - S.controller.at;
        const st = el < 3000 ? ['ContainerCreating', 'ContainerCreating', '0/1', 'ContainerCreating'] : el < 7000 ? ['Completed', 'Running', '0/1', 'Running'] : el < READY_MS ? ['Completed', 'Completed', '0/1', 'Running'] : ['Completed', 'Completed', '1/1', 'Running'];
        const a = age(S.controller.at);
        const rows = [
          ['ingress-nginx-admission-create-8xk2p', st[0] === 'Completed' ? '0/1' : '0/1', st[0], '0', a],
          ['ingress-nginx-admission-patch-q7nwd', '0/1', st[1], st[1] === 'Completed' ? '1' : '0', a],
          [CTRL_POD, st[2], st[3], '0', a],
        ];
        if (ns === 'ingress-nginx') { ctx.out(table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], rows)); if (el < READY_MS) ctx.hint('Controller READY is 0/1: still starting. Run it again in a few seconds, or use kubectl wait.'); return; }
      }
      if (ns !== NS && ns !== '*') {
        if (ns === 'kube-system') { ctx.out(table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], [['coredns-7db6d8ff4d-5kz8t', '1/1', 'Running', '0', '3d'], ['coredns-7db6d8ff4d-wq2hn', '1/1', 'Running', '0', '3d'], ['etcd-kind-control-plane', '1/1', 'Running', '0', '3d'], ['kube-apiserver-kind-control-plane', '1/1', 'Running', '0', '3d'], ['kube-proxy-9tm4c', '1/1', 'Running', '0', '3d']])); return; }
        return none();
      }
      let list = Object.entries(S.pods);
      if (name) { list = list.filter(([n]) => n === name); if (!list.length) { ctx.err(`Error from server (NotFound): pods "${name}" not found`); return; } }
      const wide = f.out === 'wide';
      const rows = list.map(([n, p]) => { const r = [n, '1/1', 'Running', '0', age(p.created)]; if (wide) r.push(p.ip, p.node); return ns === '*' ? [NS, ...r] : r; });
      const hd = ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'].concat(wide ? ['IP', 'NODE'] : []);
      ctx.out(table(ns === '*' ? ['NAMESPACE', ...hd] : hd, rows));
      return;
    }
    if (kind === 'services') {
      if (ns === 'ingress-nginx') {
        if (!controllerInstalled()) return none();
        const a = age(S.controller.at);
        ctx.out(table(['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'], [
          ['ingress-nginx-controller', 'LoadBalancer', '10.96.201.17', controllerReady() ? IP : '<pending>', '80:31080/TCP,443:31443/TCP', a],
          ['ingress-nginx-controller-admission', 'ClusterIP', '10.96.88.12', '<none>', '443/TCP', a]]));
        ctx.hint('The proxy itself is exposed by one LoadBalancer Service. Its EXTERNAL-IP is the address every Ingress reports.');
        return;
      }
      if (ns !== NS && ns !== '*') return none();
      let list = Object.entries(S.services).sort(([a], [b]) => a.localeCompare(b));
      if (name) { list = list.filter(([n]) => n === name); if (!list.length) { ctx.err(`Error from server (NotFound): services "${name}" not found`); return; } }
      if (f.out === 'yaml' && list.length === 1) {
        const [n, s] = list[0];
        const md = { name: n, namespace: NS };
        if (s.annotations) md.annotations = s.annotations;
        ctx.out(YAML.stringify({ apiVersion: 'v1', kind: 'Service', metadata: md, spec: { clusterIP: s.clusterIP, ports: s.ports.map((p) => ({ name: p.name, port: p.port, protocol: 'TCP', targetPort: p.targetPort })), selector: { app: s.selector }, type: 'ClusterIP' } }));
        return;
      }
      ctx.out(table(['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'], list.map(([n, s]) => [n, 'ClusterIP', s.clusterIP, '<none>', s.ports.map((p) => p.port + '/TCP').join(','), age(s.created)])));
      return;
    }
    if (kind === 'secrets') {
      if (ns !== NS && ns !== '*') return none();
      const list = Object.entries(S.secrets);
      if (name) { const s = S.secrets[name]; if (!s) { ctx.err(`Error from server (NotFound): secrets "${name}" not found`); return; } if (f.out === 'yaml') { ctx.out(`apiVersion: v1\ndata:\n  tls.crt: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURHVENDQWdHZ0F3SUJBZ0lVZDVr... (base64)\n  tls.key: LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2Z0lCQURBTkJna3Foa2lH... (base64)\nkind: Secret\nmetadata:\n  name: ${name}\n  namespace: ${NS}\ntype: kubernetes.io/tls`); return; } }
      if (!list.length) return none();
      ctx.out(table(['NAME', 'TYPE', 'DATA', 'AGE'], list.filter(([n]) => !name || n === name).map(([n, s]) => [n, s.type, '2', age(s.created)])));
      return;
    }
    if (kind === 'endpointslices') {
      if (ns !== NS && ns !== '*') return none();
      const env = liveEnv();
      ctx.out(table(['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'], Object.entries(S.services).sort(([a], [b]) => a.localeCompare(b)).map(([n, s]) => [n + '-' + hash(n).toString(36).slice(0, 5), 'IPv4', [...new Set(s.ports.map((p) => p.targetPort))].join(','), (endpoints(n, env) || []).map((e) => e.ip).join(',') || '<unset>', age(s.created)])));
      return;
    }
    if (kind === 'namespaces') {
      const rows = [['default', 'Active', '3d'], ['kiada', 'Active', '2d']];
      if (controllerInstalled()) rows.push(['ingress-nginx', 'Active', age(S.controller.at)]);
      rows.push(['kube-system', 'Active', '3d']);
      ctx.out(table(['NAME', 'STATUS', 'AGE'], rows));
      return;
    }
    if (kind === 'nodes') {
      ctx.out(table(['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'], [['kind-control-plane', 'Ready', 'control-plane', '3d', 'v1.31.0'], ['kind-worker', 'Ready', '<none>', '3d', 'v1.31.0'], ['kind-worker2', 'Ready', '<none>', '3d', 'v1.31.0']]));
    }
  }

  const INSTALL_LINES = [
    'namespace/ingress-nginx created', 'serviceaccount/ingress-nginx created', 'serviceaccount/ingress-nginx-admission created',
    'role.rbac.authorization.k8s.io/ingress-nginx created', 'role.rbac.authorization.k8s.io/ingress-nginx-admission created',
    'clusterrole.rbac.authorization.k8s.io/ingress-nginx created', 'clusterrole.rbac.authorization.k8s.io/ingress-nginx-admission created',
    'rolebinding.rbac.authorization.k8s.io/ingress-nginx created', 'rolebinding.rbac.authorization.k8s.io/ingress-nginx-admission created',
    'clusterrolebinding.rbac.authorization.k8s.io/ingress-nginx created', 'clusterrolebinding.rbac.authorization.k8s.io/ingress-nginx-admission created',
    'configmap/ingress-nginx-controller created', 'service/ingress-nginx-controller created', 'service/ingress-nginx-controller-admission created',
    'deployment.apps/ingress-nginx-controller created', 'job.batch/ingress-nginx-admission-create created', 'job.batch/ingress-nginx-admission-patch created',
    'ingressclass.networking.k8s.io/nginx created', 'validatingwebhookconfiguration.admissionregistration.k8s.io/ingress-nginx-admission created',
  ];
  const EXPLAIN_SPEC = `GROUP:      networking.k8s.io
KIND:       Ingress
VERSION:    v1

FIELD: spec <IngressSpec>

DESCRIPTION:
    spec is the desired state of the Ingress.
    IngressSpec describes the Ingress the user wishes to exist.

FIELDS:
  defaultBackend	<IngressBackend>
    defaultBackend is the backend that should handle requests that don't match
    any rule. If Rules are not specified, DefaultBackend must be specified.

  ingressClassName	<string>
    ingressClassName is the name of an IngressClass cluster resource. Ingress
    controller implementations use this field to know whether they should be
    serving this Ingress resource.

  rules	<[]IngressRule>
    rules is a list of host rules used to configure the Ingress. If unspecified,
    or no rule matches, all traffic is sent to the default backend.

  tls	<[]IngressTLS>
    tls represents the TLS configuration. Currently the Ingress only supports a
    single TLS port, 443.`;
  const EXPLAIN_ING = `GROUP:      networking.k8s.io
KIND:       Ingress
VERSION:    v1

DESCRIPTION:
    Ingress is a collection of rules that allow inbound connections to reach the
    endpoints defined by a backend.

FIELDS:
  apiVersion	<string>
  kind	<string>
  metadata	<ObjectMeta>
  spec	<IngressSpec>
  status	<IngressStatus>`;

  function parseUrl(u) {
    let scheme = 'http';
    const m = u.match(/^(\w+):\/\//);
    if (m) { scheme = m[1].toLowerCase(); u = u.slice(m[0].length); }
    const slash = u.indexOf('/');
    let hostport = slash >= 0 ? u.slice(0, slash) : u;
    let path = slash >= 0 ? u.slice(slash) : '/';
    path = path.split('?')[0].split('#')[0] || '/';
    let [host, port] = hostport.split(':');
    port = port ? Number(port) : scheme === 'https' ? 443 : 80;
    return { scheme, host: (host || '').toLowerCase(), port, path };
  }
  const isIP = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h);
  function hostsLookup(h) {
    for (const line of S.hosts) { const [ip, ...names] = line.trim().split(/\s+/); if (names.includes(h)) return ip; }
    if (h === 'localhost') return '127.0.0.1';
    return null;
  }

  async function curl(argv, ctx) {
    const o = { headers: [], resolve: [], v: false, k: false, I: false, url: null, method: 'GET' };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '-v' || a === '--verbose') o.v = true;
      else if (a === '-k' || a === '--insecure') o.k = true;
      else if (a === '-I' || a === '--head') { o.I = true; o.method = 'HEAD'; }
      else if (a === '-H' || a === '--header') o.headers.push(argv[++i] || '');
      else if (a === '--resolve') o.resolve.push(argv[++i] || '');
      else if (a === '-X' || a === '--request') o.method = (argv[++i] || 'GET').toUpperCase();
      else if (a === '-s' || a === '--silent' || a === '-L' || a === '-i') { if (a === '-i') o.i = true; }
      else if (/^-[vkIsLi]+$/.test(a)) { if (a.includes('v')) o.v = true; if (a.includes('k')) o.k = true; if (a.includes('I')) { o.I = true; o.method = 'HEAD'; } if (a.includes('i')) o.i = true; }
      else if (a.startsWith('-')) { ctx.err(`curl: option ${a}: is unknown`); return; }
      else o.url = a;
    }
    if (!o.url) { ctx.err("curl: no URL specified!\ncurl: try 'curl --help' or 'curl --manual' for more information"); return; }
    const u = parseUrl(o.url);
    if (!['http', 'https'].includes(u.scheme)) { ctx.err(`curl: (1) Protocol "${u.scheme}" not supported`); return; }
    const V = (s) => { if (o.v) ctx.out(s, 'dim'); };
    let ip = null, cached = false;
    for (const r of o.resolve) {
      const [h, p, addr] = r.split(':');
      V(`* Added ${h}:${p}:${addr} to DNS cache`);
      if (h === u.host && Number(p) === u.port) { ip = addr; cached = true; }
    }
    if (!ip) ip = isIP(u.host) ? u.host : hostsLookup(u.host);
    if (!ip) {
      V(`* Could not resolve host: ${u.host}`);
      ctx.err(`curl: (6) Could not resolve host: ${u.host}`);
      if (/example\.com$/.test(u.host)) ctx.hint(`Nothing maps ${u.host} to the Ingress IP. Either pass --resolve ${u.host}:${u.port}:${IP} or add it to /etc/hosts.`);
      return;
    }
    if (cached) V(`* Hostname ${u.host} was found in DNS cache`);
    V(`*   Trying ${ip}:${u.port}...`);
    if (ip !== IP) {
      await ctx.sleep(1400);
      ctx.err(`curl: (28) Failed to connect to ${u.host} port ${u.port} after 1400 ms: Couldn't connect to server`);
      if (ip !== '127.0.0.1') ctx.hint(`Nothing answers at ${ip}. The ingress proxy in this cluster is at ${IP}.`);
      return;
    }
    if (!controllerReady() || ![80, 443].includes(u.port)) {
      ctx.err(`curl: (7) Failed to connect to ${u.host} port ${u.port} after 3 ms: Couldn't connect to server`);
      if (!controllerInstalled()) ctx.hint('Nothing listens on the Ingress IP yet: install the ingress controller first (section 12.1.3).');
      else if (!controllerReady()) ctx.hint('The controller pod is still starting. Try again in a few seconds.');
      else ctx.hint('The proxy only listens on ports 80 and 443.');
      return;
    }
    V(`* Connected to ${u.host} (${ip}) port ${u.port}`);
    const env = liveEnv();
    let h2 = false;
    if (u.scheme === 'https') {
      const cert = certFor(u.host, env);
      if (o.v) {
        ['* ALPN: curl offers h2,http/1.1', '* TLSv1.3 (OUT), TLS handshake, Client hello (1):', '* TLSv1.3 (IN), TLS handshake, Server hello (2):', '* TLSv1.3 (IN), TLS handshake, Encrypted Extensions (8):', '* TLSv1.3 (IN), TLS handshake, Certificate (11):', '* TLSv1.3 (IN), TLS handshake, CERT verify (15):', '* TLSv1.3 (IN), TLS handshake, Finished (20):', '* TLSv1.3 (OUT), TLS handshake, Finished (20):', '* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384 / X25519 / RSASSA-PSS', '* ALPN: server accepted h2', '* Server certificate:'].forEach(V);
        if (cert.fake) { V('*  subject: O=Acme Co; CN=Kubernetes Ingress Controller Fake Certificate'); V(`*  start date: ${certDate(S.controller.at)}`); V(`*  expire date: ${certDate(S.controller.at + 365 * 86400e3)}`); V(`*  subjectAltName does not match ${u.host}`); V('*  issuer: O=Acme Co; CN=Kubernetes Ingress Controller Fake Certificate'); }
        else { V('*  subject: CN=*.example.com'); V(`*  start date: ${certDate(S.certAt || now())}`); V(`*  expire date: ${certDate((S.certAt || now()) + 7300 * 86400e3)}`); V(`*  subjectAltName: host "${u.host}" matched cert's "*.example.com"`); V('*  issuer: CN=*.example.com'); }
      }
      if (!o.k) {
        if (cert.fake) ctx.err(`curl: (60) SSL: no alternative certificate subject name matches target host name '${u.host}'`);
        else ctx.err('curl: (60) SSL certificate problem: self-signed certificate');
        ctx.out('More details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it.', 'dim');
        ctx.hint(cert.fake ? 'No TLS Secret covers this host, so nginx served its built-in fake certificate. Add spec.tls to the Ingress (12.3.2), or pass -k to skip verification.' : 'The certificate is self-signed, so curl cannot verify it. For a lab, -k skips the check.');
        return;
      }
      V(`*  SSL certificate verify result: ${cert.fake ? 'unable to get local issuer certificate (20)' : 'self-signed certificate (18)'}, continuing anyway.`);
      h2 = true;
    }
    const cookie = (o.headers.find((h) => /^cookie:/i.test(h)) || '').replace(/^cookie:\s*/i, '');
    const req = { scheme: u.scheme, host: u.host, path: u.path, method: o.method === 'HEAD' ? 'HEAD' : o.method, cookie };
    const { resp } = request(req, env, true);
    save();
    const proto = h2 ? 'HTTP/2' : 'HTTP/1.1';
    if (o.v) {
      ctx.out(`> ${req.method} ${u.path} ${proto}\n> Host: ${u.host}${u.port !== 80 && u.port !== 443 ? ':' + u.port : ''}\n> User-Agent: curl/8.5.0\n> Accept: */*${o.headers.map((h) => '\n> ' + h).join('')}\n>`, 'dim');
    }
    const status = h2 ? `HTTP/2 ${resp.status}` : `HTTP/1.1 ${resp.status} ${resp.statusText}`;
    const hdrs = [['Date', httpDate()], ['Content-Type', resp.ctype || 'text/html'], ['Content-Length', String(resp.body.length)]];
    if (!h2) hdrs.push(['Connection', 'keep-alive']);
    for (const h of resp.headers || []) hdrs.push(h);
    if (u.scheme === 'https') hdrs.push(['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']);
    const hl = [status, ...hdrs.map(([k, v]) => (h2 ? k.toLowerCase() : k) + ': ' + v)];
    if (o.v) ctx.out(hl.map((l) => '< ' + l).join('\n') + '\n<', 'dim');
    else if (o.I || o.i) ctx.out(hl.join('\n') + (o.i ? '\n' : ''), o.I ? '' : 'dim');
    if (!o.I) ctx.out(resp.body);
    if (o.v) V(`* Connection #0 to host ${u.host} left intact`);
  }

  function openssl(argv, ctx) {
    if (argv[0] !== 'req') { ctx.out('(this simulator supports: openssl req -x509 -newkey rsa:2048 -keyout example.key -out example.crt ...)', 'hint'); return; }
    const ko = argv.indexOf('-keyout'), oo = argv.indexOf('-out');
    const key = ko >= 0 ? argv[ko + 1] : 'privkey.pem', crt = oo >= 0 ? argv[oo + 1] : null;
    const dots = () => Array.from({ length: 64 }, () => '.+*'[Math.floor(Math.random() * 3)]).join('');
    ctx.out(`${dots()}\n${dots().slice(0, 40)}+++++\n${dots()}\n${dots().slice(0, 22)}+++++\n-----`);
    for (const fl of [key, crt]) if (fl && !S.files.includes(fl)) S.files.push(fl);
    S.certAt = now();
    save();
  }

  async function exec(line, ctx) {
    const raw = line.trim();
    if (!raw) return;
    if (raw !== S.history[S.history.length - 1]) { S.history.push(raw); if (S.history.length > 200) S.history.shift(); }
    save();
    // pipes / redirects we care about
    let m;
    if ((m = raw.match(/^echo\s+(.+?)\s*\|\s*sudo\s+tee\s+(-a\s+)?\/etc\/hosts\s*$/))) {
      const text = tokenize(m[1]).join(' ');
      if (!m[2]) { S.hosts = []; }
      S.hosts.push(text);
      save();
      ctx.out(text);
      if (!m[2]) ctx.hint('Without -a, tee overwrote /etc/hosts (localhost lines are kept here for your sanity).');
      return;
    }
    if (/>>?\s*\/etc\/hosts/.test(raw)) { ctx.err('bash: /etc/hosts: Permission denied'); ctx.hint('The redirect runs as you, not as root. Use: echo "..." | sudo tee -a /etc/hosts'); return; }
    const argv = tokenize(raw);
    let cmd = argv.shift();
    if (cmd === 'sudo') cmd = argv.shift();
    if (cmd === 'k') cmd = 'kubectl';
    switch (cmd) {
      case 'help': case '?': ctx.out(help); return;
      case 'clear': case 'cls': ctx.clear(); return;
      case 'history': ctx.out(S.history.map((h, i) => String(i + 1).padStart(4) + '  ' + h).join('\n')); return;
      case 'reset': {
        const h = S.history; S = fresh(); S.history = h; save();
        ctx.ok('Cluster reset: kiada, quote and quiz are running; no ingress controller, no Ingresses.');
        return;
      }
      case 'catchup': catchup(argv[0] || '', ctx); return;
      case 'pwd': ctx.out('/home/kiada/Chapter12'); return;
      case 'whoami': ctx.out('kiada'); return;
      case 'date': ctx.out(new Date().toString()); return;
      case 'exit': case 'logout': ctx.out('nice try. there is no outside. (Esc closes the drop-down shell)', 'hint'); return;
      case 'echo': ctx.out(argv.join(' ')); return;
      case 'ls': case 'll': case 'dir': {
        const target = argv.filter((a) => !a.startsWith('-'))[0];
        if (target && target.replace(/\/$/, '') === 'SETUP') { ctx.out(DIRS.SETUP.join('  ')); return; }
        if (target) { ctx.err(`ls: cannot access '${target}': No such file or directory`); return; }
        const names = ['SETUP/', ...Object.keys(FILES).sort(), ...S.files];
        ctx.out(names.map((n) => n.endsWith('/') ? `\u0001${n}\u0002` : n).join('\n'), 'ls');
        return;
      }
      case 'cat': case 'less': case 'more': case 'bat': {
        const fl = argv[0];
        if (!fl) { ctx.err('cat: missing operand'); return; }
        if (fl === '/etc/hosts') { ctx.out(['127.0.0.1   localhost', '::1         localhost ip6-localhost ip6-loopback', ...S.hosts].join('\n')); return; }
        const clean = fl.replace(/^\.\//, '');
        if (FILES[clean]) { ctx.out(FILES[clean], 'yaml'); return; }
        if (clean === 'example.crt' && S.files.includes(clean)) { ctx.out('-----BEGIN CERTIFICATE-----\nMIIDGTCCAgGgAwIBAgIUd5kQx2v7Tn0bS1y3Jm9QzR4hP0wwDQYJKoZIhvcNAQEL\nBQAwGDEWMBQGA1UEAwwNKi5leGFtcGxlLmNvbTAeFw0yNjExMDQxMDEyMDNaFw00\nNjEwMzAxMDEyMDNaMBgxFjAUBgNVBAMMDSouZXhhbXBsZS5jb20wggEiMA0GCSqG\n... (subject CN=*.example.com, SAN DNS:*.example.com, valid 7300 days)\n-----END CERTIFICATE-----'); return; }
        if (clean === 'example.key' && S.files.includes(clean)) { ctx.out('-----BEGIN PRIVATE KEY-----\n(it is a private key. imagine 1,700 characters of base64 and keep it secret.)\n-----END PRIVATE KEY-----'); return; }
        if (clean.startsWith('SETUP/')) { ctx.out('(chapter 11 manifest: pods and services of the kiada suite, already applied)', 'hint'); return; }
        if (clean === 'SETUP') { ctx.err('cat: SETUP: Is a directory'); return; }
        ctx.err(`cat: ${fl}: No such file or directory`);
        return;
      }
      case 'kubectl': return kubectl(argv, ctx);
      case 'curl': return curl(argv, ctx);
      case 'openssl': return openssl(argv, ctx);
      case 'nslookup': case 'dig': case 'host': {
        const h = argv.filter((a) => !a.startsWith('-') && !a.startsWith('+'))[0];
        if (!h) { ctx.err(`${cmd}: missing host`); return; }
        ctx.out(`Server:\t\t1.1.1.1\nAddress:\t1.1.1.1#53\n\n** server can't find ${h}: NXDOMAIN`);
        if (hostsLookup(h)) ctx.hint(`${cmd} queries a DNS server directly and skips /etc/hosts, so it can't see your entry. curl and browsers do use /etc/hosts. Try: getent hosts ${h}`);
        else ctx.hint('example.com subdomains are not in public DNS. In production you would add an A record pointing at the Ingress IP.');
        return;
      }
      case 'getent': {
        const h = argv[1];
        const ip = h && hostsLookup(h);
        if (ip) ctx.out(`${ip}      ${h}`); else ctx.out('', '');
        return;
      }
      case 'minikube': {
        if (argv[0] === 'addons' && argv[1] === 'enable' && argv[2] === 'ingress') {
          const lines = ['💡  ingress is an addon maintained by Kubernetes. For any concerns contact minikube on GitHub.', '    ▪ Using image registry.k8s.io/ingress-nginx/controller:v1.11.3', '    ▪ Using image registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.4.4', '    ▪ Using image registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.4.4', '🔎  Verifying ingress addon...'];
          for (const l of lines) { ctx.out(l); await ctx.sleep(260); }
          if (!controllerInstalled()) installController(now() - READY_MS + 1500);
          await ctx.sleep(1500);
          save();
          ctx.out("🌟  The 'ingress' addon is enabled");
          return;
        }
        if (argv[0] === 'ip') { ctx.out('192.168.49.2'); ctx.hint(`On a real minikube you'd use this VM IP. This simulated cluster's ingress answers on ${IP}.`); return; }
        if (argv[0] === 'tunnel') { ctx.out('✅  Tunnel successfully started\n\n📌  NOTE: Please do not close this terminal as this process must stay alive for the tunnel to be accessible ...'); return; }
        ctx.out('(this simulator supports: minikube addons enable ingress, minikube ip, minikube tunnel)', 'hint');
        return;
      }
      case 'vim': case 'vi': case 'nano': case 'emacs': ctx.out(`${cmd}: no editors in here. (Escaping vim is chapter 0.)`, 'hint'); return;
      case 'rm': ctx.out("rm: let's not.", 'hint'); return;
      case 'kind': ctx.out('(the kind cluster is already up: kind-control-plane, kind-worker, kind-worker2)', 'hint'); return;
      default:
        ctx.err(`bash: ${cmd}: command not found`);
        ctx.hint('Type help to see what this shell understands.');
    }
  }

  window.SIM = {
    IP, exec, route, pathScore, hostScore, splitPath, request, liveEnv, bookEnv, endpoints,
    state: () => S, on: (f) => { listeners.add(f); return () => listeners.delete(f); },
    controllerReady, controllerInstalled, ingAddress, tokenize,
    completions: () => ({ files: [...Object.keys(FILES), ...S.files, 'SETUP/'] }),
    sections: ORDER,
  };
})();
