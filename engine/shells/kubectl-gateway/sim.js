// Simulated cluster + shell for chapter 13 (Gateway API). Shared by every terminal on the page.
(function () {
  'use strict';
  const NS = 'kiada';
  const KEY = 'kia13-state-v1';
  const GROUP = 'gateway.networking.k8s.io';
  const CONTROLLER = 'istio.io/gateway-controller';
  const ISTIO_READY_MS = 10000;   // istiod becomes Ready this long after `istioctl install`
  const GW_SYNC_MS = 600;         // a Gateway is programmed this long after istiod is ready / the Gateway is created
  const ROUTE_SYNC_MS = 400;      // a Route gets its status this long after creation
  const POD_START_MS = 3000;      // new pods become Ready after this long
  const ISTIOD = 'istiod-7448594799-fwd44';
  const CLIENT_IP = '172.18.0.1';
  const ISTIO_VERSION = '1.24.0';
  const NODE_IPS = { 'kind-control-plane': '172.18.0.2', 'kind-worker': '172.18.0.3', 'kind-worker2': '172.18.0.4' };
  const FIXED_GW_IPS = { kiada: '172.18.255.200', 'test-gtw': '172.18.255.201', shared: '172.18.255.202' };
  const NODE_PORTS = { 80: 32313, 443: 30443, 200: 31200, 300: 31300, 900: 30900 };
  const CRD_PLURALS = ['gatewayclasses', 'gateways', 'grpcroutes', 'httproutes', 'referencegrants', 'tcproutes', 'tlsroutes', 'udproutes'];
  const CRD_NAMES = CRD_PLURALS.map((p) => p + '.' + GROUP);
  const ROUTE_KINDS = ['HTTPRoute', 'TLSRoute', 'TCPRoute', 'UDPRoute', 'GRPCRoute'];
  const IMPLEMENTED = ['HTTPRoute', 'TLSRoute', 'TCPRoute'];   // what Istio (book version) reconciles
  const ROUTE_VER = { HTTPRoute: 'v1', GRPCRoute: 'v1alpha2', TLSRoute: 'v1alpha2', TCPRoute: 'v1alpha2', UDPRoute: 'v1alpha2' };
  const PROTO_KINDS = { HTTP: ['HTTPRoute', 'GRPCRoute'], HTTPS: ['HTTPRoute', 'GRPCRoute'], TLS: ['TLSRoute'], TCP: ['TCPRoute'], UDP: ['UDPRoute'] };
  const PLURAL = { Gateway: 'gateways', HTTPRoute: 'httproutes', TLSRoute: 'tlsroutes', TCPRoute: 'tcproutes', UDPRoute: 'udproutes', GRPCRoute: 'grpcroutes', ReferenceGrant: 'referencegrants' };
  const listeners = new Set();
  let S;

  const BASE = [
    ['kiada-001', '10.244.1.12', 'kind-worker', 'kiada'], ['kiada-002', '10.244.2.8', 'kind-worker2', 'kiada'], ['kiada-003', '10.244.1.13', 'kind-worker', 'kiada'],
    ['quote-001', '10.244.2.9', 'kind-worker2', 'quote'], ['quote-002', '10.244.1.14', 'kind-worker', 'quote'], ['quote-003', '10.244.2.10', 'kind-worker2', 'quote'],
    ['quiz', '10.244.1.15', 'kind-worker', 'quiz'],
  ];
  const BASE_SVCS = {
    kiada: { clusterIP: '10.96.172.41', selector: { app: 'kiada' }, ports: [{ name: 'http', port: 80, targetPort: 8080, protocol: 'TCP' }, { name: 'https', port: 443, targetPort: 8443, protocol: 'TCP' }] },
    quote: { clusterIP: '10.96.21.120', selector: { app: 'quote' }, ports: [{ name: 'http', port: 80, targetPort: 80, protocol: 'TCP' }] },
    quiz: { clusterIP: '10.96.94.233', selector: { app: 'quiz' }, ports: [{ name: 'http', port: 80, targetPort: 8080, protocol: 'TCP' }] },
  };
  const KUBE_SYSTEM_PODS = [
    ['coredns-7db6d8ff4d-5kz8t', '10.244.0.3', 'kind-control-plane'], ['coredns-7db6d8ff4d-wq2hn', '10.244.0.2', 'kind-control-plane'],
    ['etcd-kind-control-plane', '172.18.0.2', 'kind-control-plane'], ['kindnet-6xk2v', '172.18.0.3', 'kind-worker'], ['kindnet-8fvpd', '172.18.0.4', 'kind-worker2'], ['kindnet-mq5dh', '172.18.0.2', 'kind-control-plane'],
    ['kube-apiserver-kind-control-plane', '172.18.0.2', 'kind-control-plane'], ['kube-controller-manager-kind-control-plane', '172.18.0.2', 'kind-control-plane'],
    ['kube-proxy-9tm4c', '172.18.0.3', 'kind-worker'], ['kube-proxy-hl7pw', '172.18.0.4', 'kind-worker2'], ['kube-proxy-v2wrs', '172.18.0.2', 'kind-control-plane'],
    ['kube-scheduler-kind-control-plane', '172.18.0.2', 'kind-control-plane'],
  ];

  function hash(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  const now = () => Date.now();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
  const pad2 = (n) => String(n).padStart(2, '0');
  const rid = (s, n, alpha = 'bcdfghjklmnpqrstvwxz2456789') => { let h = hash(s), o = ''; for (let i = 0; i < n; i++) { o += alpha[h % alpha.length]; h = (Math.imul(h, 1103515245) + 12345) >>> 0; } return o; };

  function mkPod(ns, name, o) {
    return Object.assign({ ns, name, ip: '', node: 'kind-worker', labels: {}, kind: 'other', version: '0.5', containers: ['main'], created: now() }, o);
  }
  function fresh() {
    const t = now() - 2 * 86400e3 - 3 * 3600e3;
    const d = {
      curNs: NS, crds: null, istioctl: false, istio: null,
      namespaces: { default: { labels: {}, created: t - 86400e3 }, 'kube-node-lease': { labels: {}, created: t - 86400e3 }, 'kube-public': { labels: {}, created: t - 86400e3 }, 'kube-system': { labels: {}, created: t - 86400e3 }, [NS]: { labels: {}, created: t } },
      pods: {}, services: {}, secrets: {}, gateways: {}, routes: {}, grants: {}, hosts: [], plog: {}, glog: {}, rr: {}, history: [], podSeq: 0, ipSeq: 0,
    };
    for (const [name, ip, node, kind] of BASE) {
      d.pods[NS + '/' + name] = mkPod(NS, name, { ip, node, kind, version: '0.5', labels: kind === 'kiada' ? { app: 'kiada', rel: 'stable' } : { app: kind }, containers: kind === 'kiada' ? ['kiada', 'envoy'] : kind === 'quote' ? ['quote-writer', 'nginx'] : ['quiz-api', 'mongo'], created: t, base: true });
    }
    for (const [name, v] of Object.entries(BASE_SVCS)) d.services[NS + '/' + name] = { ns: NS, name, type: 'ClusterIP', ...clone(v), created: t, base: true };
    d.secrets[NS + '/kiada-tls'] = { ns: NS, name: 'kiada-tls', type: 'kubernetes.io/tls', created: t };
    return d;
  }
  function load() {
    try { const j = localStorage.getItem(KEY); if (j) { const x = JSON.parse(j); if (x && x.gateways && x.pods) { S = x; return; } } } catch (e) { /* ignore */ }
    S = fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
    listeners.forEach((f) => { try { f(S); } catch (e) { console.error(e); } });
  }
  load();

  // ---------- helpers ----------
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
    const w = headers.map((_, c) => Math.max(...all.map((r) => String(r[c] == null ? '' : r[c]).length)));
    return all.map((r) => r.map((v, c) => c === r.length - 1 ? String(v == null ? '' : v) : String(v == null ? '' : v).padEnd(w[c] + 3)).join('').replace(/\s+$/, '')).join('\n');
  }
  const httpDate = () => new Date().toUTCString();
  const tsMs = () => new Date().toISOString();
  function certDate(t) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(t);
    return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`;
  }
  const uidOf = (s) => { const hx = (x, n) => hash(x).toString(16).padStart(8, '0').repeat(3).slice(0, n); return `${hx(s, 8)}-${hx(s + 1, 4)}-4${hx(s + 2, 3)}-9${hx(s + 3, 3)}-${hx(s + 4, 12)}`; };
  const rvOf = (rec) => String(10000 + (hash((rec.kind || '') + rec.name + rec.ns + (rec.created % 1000)) % 80000) + (rec.gen || 1) * 7);
  function sortDeep(v) {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortDeep(v[k]); return o; }
    return v;
  }
  function yq(s) {
    s = String(s);
    if (s === '') return '""';
    if (/^(true|false|yes|no|on|off|null|y|n|~)$/i.test(s) || /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^\d{4}-\d\d-\d\d/.test(s)) return JSON.stringify(s);
    if (/^[*&!|>%@`'"#[\]{},?]/.test(s) || /^[-:](\s|$)/.test(s) || /: |\s#|:$|^\s|\s$/.test(s)) return "'" + s.replace(/'/g, "''") + "'";
    return s;
  }
  const ys = (v) => v === null || v === undefined ? 'null' : typeof v === 'string' ? yq(v) : String(v);
  function toYaml(v, ind = 0) {
    const pad = ' '.repeat(ind);
    const isO = (x) => x && typeof x === 'object' && !Array.isArray(x);
    if (Array.isArray(v)) {
      return v.map((item) => {
        if (isO(item) && Object.keys(item).length) return pad + '- ' + toYaml(item, ind + 2).slice(ind + 2);
        if (Array.isArray(item) && item.length) return pad + '- ' + toYaml(item, ind + 2).slice(ind + 2);
        if (isO(item) || Array.isArray(item)) return pad + '- ' + (Array.isArray(item) ? '[]' : '{}');
        return pad + '- ' + ys(item);
      }).join('\n');
    }
    return Object.entries(v).filter(([, val]) => val !== undefined).map(([k, val]) => {
      if (Array.isArray(val)) return val.length ? `${pad}${k}:\n${toYaml(val, ind)}` : `${pad}${k}: []`;
      if (isO(val)) return Object.keys(val).length ? `${pad}${k}:\n${toYaml(val, ind + 2)}` : `${pad}${k}: {}`;
      return `${pad}${k}: ${ys(val)}`;
    }).join('\n');
  }
  const yamlOf = (o) => toYaml(sortDeep(o));
  function jsonPath(obj, expr) {
    // {.a.b[0].c} and {.items[*].metadata.name}; text outside braces is kept
    return expr.replace(/\{([^}]*)\}/g, (_, p) => {
      let cur = [obj];
      for (const tok of p.replace(/^\./, '').match(/[^.[\]]+|\[[^\]]*\]/g) || []) {
        const next = [];
        for (const c of cur) {
          if (c === undefined || c === null) continue;
          if (tok === '[*]') { if (Array.isArray(c)) next.push(...c); }
          else if (/^\[\d+\]$/.test(tok)) next.push(c[+tok.slice(1, -1)]);
          else next.push(c[tok]);
        }
        cur = next;
      }
      return cur.filter((x) => x !== undefined).map((x) => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ');
    }).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  function parseSelector(sel) {
    // supports k=v, k==v, k!=v, k, !k, k in (a,b), k notin (a,b); comma = AND
    const parts = [];
    let depth = 0, cur = '';
    for (const c of sel) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && !depth) { parts.push(cur); cur = ''; } else cur += c; }
    if (cur) parts.push(cur);
    const tests = parts.map((p) => p.trim()).filter(Boolean).map((p) => {
      let m;
      if ((m = p.match(/^([^\s!=]+)\s+(in|notin)\s*\(([^)]*)\)$/))) { const vals = m[3].split(',').map((x) => x.trim()); return (l) => (m[2] === 'in') === (l[m[1]] !== undefined && vals.includes(l[m[1]])); }
      if ((m = p.match(/^([^\s!=]+)\s*!=\s*(.*)$/))) return (l) => l[m[1]] !== m[2];
      if ((m = p.match(/^([^\s!=]+)\s*==?\s*(.*)$/))) return (l) => l[m[1]] === m[2];
      if (p[0] === '!') return (l) => l[p.slice(1)] === undefined;
      return (l) => l[p] !== undefined;
    });
    return (labels) => tests.every((t) => t(labels || {}));
  }
  const labelStr = (l) => Object.entries(l || {}).map(([k, v]) => k + '=' + v).join(',');

  // ---------- pods, services, endpoints ----------
  function podState(p) {
    const total = p.containers.length;
    const el = now() - p.created;
    if (p.istiod) {
      if (el < 2500) return { ready: 0, total, status: 'ContainerCreating', isReady: false };
      if (el < ISTIO_READY_MS) return { ready: 0, total, status: 'Running', isReady: false };
      return { ready: total, total, status: 'Running', isReady: true };
    }
    if (p.always || p.base) return { ready: total, total, status: 'Running', isReady: true };
    if (el < 1000) return { ready: 0, total, status: 'ContainerCreating', isReady: false };
    if (el < POD_START_MS) return { ready: Math.max(0, total - 1), total, status: 'Running', isReady: false };
    return { ready: total, total, status: 'Running', isReady: true };
  }
  function endpointsOf(svc, pods) {
    const sel = svc.selector || {};
    if (!Object.keys(sel).length) return [];
    return (pods || Object.values(S.pods)).filter((p) => p.ns === svc.ns && Object.entries(sel).every(([k, v]) => p.labels[k] === v) && podState(p).isReady);
  }
  function svcPortStr(s) { return s.ports.map((p) => p.nodePort ? `${p.port}:${p.nodePort}/${p.protocol || 'TCP'}` : `${p.port}/${p.protocol || 'TCP'}`).join(','); }
  function newClusterIP(name) { return `10.96.${100 + (hash(name) % 120)}.${2 + (hash(name + 'x') % 250)}`; }
  function nextPodIp() { const n = ++S.podSeq; return { ip: `10.244.${1 + (n % 2)}.${20 + n}`, node: n % 2 ? 'kind-worker2' : 'kind-worker' }; }

  // ---------- Gateway API: defaults ----------
  function defaultSpec(kind, spec) {
    const s = clone(spec || {});
    if (kind === 'Gateway') {
      for (const l of s.listeners || []) {
        if (!l.allowedRoutes) l.allowedRoutes = {};
        if (!l.allowedRoutes.namespaces) l.allowedRoutes.namespaces = {};
        if (!l.allowedRoutes.namespaces.from) l.allowedRoutes.namespaces.from = 'Same';
        if (l.tls) {
          if (!l.tls.mode) l.tls.mode = 'Terminate';
          for (const c of l.tls.certificateRefs || []) { if (c.group === undefined) c.group = ''; if (!c.kind) c.kind = 'Secret'; }
        }
      }
      return s;
    }
    if (kind === 'ReferenceGrant') return s;
    for (const p of s.parentRefs || []) { if (p.group === undefined) p.group = GROUP; if (!p.kind) p.kind = 'Gateway'; }
    const refDefaults = (b, weight) => { if (b.group === undefined) b.group = ''; if (!b.kind) b.kind = 'Service'; if (weight && b.weight === undefined) b.weight = 1; };
    for (const rule of s.rules || []) {
      if (kind === 'HTTPRoute') {
        if (!(rule.matches && rule.matches.length)) rule.matches = [{}];
        for (const m of rule.matches) {
          if (!m.path) m.path = { type: 'PathPrefix', value: '/' };
          if (!m.path.type) m.path.type = 'PathPrefix';
          if (m.path.value === undefined) m.path.value = '/';
          for (const h of m.headers || []) if (!h.type) h.type = 'Exact';
          for (const q of m.queryParams || []) if (!q.type) q.type = 'Exact';
        }
      }
      if (kind === 'GRPCRoute') for (const m of rule.matches || []) { if (m.method && !m.method.type) m.method.type = 'Exact'; for (const h of m.headers || []) if (!h.type) h.type = 'Exact'; }
      for (const b of rule.backendRefs || []) { refDefaults(b, true); for (const f of b.filters || []) if (f.type === 'RequestRedirect' && f.requestRedirect && !f.requestRedirect.statusCode) f.requestRedirect.statusCode = 302; }
      for (const f of rule.filters || []) {
        if (f.type === 'RequestMirror' && f.requestMirror && f.requestMirror.backendRef) refDefaults(f.requestMirror.backendRef, false);
        if (f.type === 'RequestRedirect') { if (!f.requestRedirect) f.requestRedirect = {}; if (!f.requestRedirect.statusCode) f.requestRedirect.statusCode = 302; }
      }
    }
    return s;
  }

  // ---------- Gateway API: hostnames ----------
  function intersectHosts(a, b) {
    if (!a || a === '*') return b || '*';
    if (!b || b === '*') return a;
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return a;
    const aw = a.startsWith('*.'), bw = b.startsWith('*.');
    if (!aw && !bw) return null;
    if (aw && !bw) return b.endsWith(a.slice(1)) ? b : null;
    if (!aw && bw) return a.endsWith(b.slice(1)) ? a : null;
    if (a.endsWith(b.slice(1))) return a;
    if (b.endsWith(a.slice(1))) return b;
    return null;
  }
  // how well a (route/listener) hostname pattern matches a request host: -1 no, 1 any, 1000+len wildcard, 100000 exact
  function hostMatchScore(pattern, host) {
    host = (host || '').toLowerCase();
    if (!pattern || pattern === '*') return 1;
    pattern = pattern.toLowerCase();
    if (pattern === host) return 100000;
    if (pattern.startsWith('*.') && host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1) return 1000 + pattern.length;
    return -1;
  }
  // legacy helpers (kept for widgets): 2 exact, 1 wildcard, 0 no rule host, -1 no match
  function hostScore(ruleHost, reqHost) {
    if (!ruleHost) return 0;
    const s = hostMatchScore(ruleHost, reqHost);
    return s === 100000 ? 2 : s >= 1000 ? 1 : s === 1 ? 0 : -1;
  }
  function splitPath(p) { return (p || '/').split('/').filter(Boolean); }
  function pathScore(type, rulePath, reqPath) {
    rulePath = rulePath || '/';
    if (type === 'Exact') return rulePath === reqPath ? 10000 + rulePath.length : -1;
    if (type === 'RegularExpression') { try { return new RegExp('^(?:' + rulePath + ')$').test(reqPath) ? 500 : -1; } catch (e) { return -1; } }
    const r = splitPath(rulePath), q = splitPath(reqPath);
    if (r.length > q.length) return -1;
    for (let i = 0; i < r.length; i++) if (r[i] !== q[i]) return -1;
    return r.length;
  }
  function fullMatch(re, s) { try { return new RegExp('^(?:' + re + ')$').test(s); } catch (e) { return false; } }

  // ---------- Gateway API: cluster view (what the controller would compute) ----------
  const controllerReady = () => !!S.istio && now() - S.istio.at >= ISTIO_READY_MS;
  const controllerInstalled = () => !!S.istio;
  const crdsInstalled = () => !!S.crds;
  const controllerActive = () => crdsInstalled() && controllerReady();
  const readyAt = () => (S.istio ? S.istio.at + ISTIO_READY_MS : Infinity);

  function cond(type, status, reason, message, gen, t) {
    return { lastTransitionTime: iso(t), message, observedGeneration: gen, reason, status, type };
  }
  function nsAllowed(l, gwNs, routeNs) {
    const n = (l.allowed && l.allowed.namespaces) || { from: 'Same' };
    if (n.from === 'All') return true;
    if (n.from === 'Selector') {
      const labels = (S.namespaces[routeNs] || { labels: {} }).labels;
      const sel = n.selector || {};
      for (const [k, v] of Object.entries(sel.matchLabels || {})) if (labels[k] !== v) return false;
      for (const e of sel.matchExpressions || []) {
        const has = labels[e.key] !== undefined, vals = e.values || [];
        if (e.operator === 'In' && !(has && vals.includes(labels[e.key]))) return false;
        if (e.operator === 'NotIn' && has && vals.includes(labels[e.key])) return false;
        if (e.operator === 'Exists' && !has) return false;
        if (e.operator === 'DoesNotExist' && has) return false;
      }
      return true;
    }
    return routeNs === gwNs;
  }
  function grantAllows(fromKind, fromNs, toNs, toKind, toName) {
    return Object.values(S.grants).some((g) => g.ns === toNs
      && (g.spec.from || []).some((f) => (f.group || '') === GROUP && f.kind === fromKind && f.namespace === fromNs)
      && (g.spec.to || []).some((t) => (t.group || '') === '' && t.kind === toKind && (!t.name || t.name === toName)));
  }
  function resolveBackendRef(route, ref) {
    const group = ref.group || '', kind = ref.kind || 'Service';
    if (group !== '' || kind !== 'Service') return { err: 'InvalidKind', message: `referencing unsupported backendRef: group "${group}" kind "${kind}"` };
    const ns = ref.namespace || route.ns;
    if (ns !== route.ns && !grantAllows(route.kind, route.ns, ns, 'Service', ref.name)) return { err: 'RefNotPermitted', message: `backendRef ${ref.name}/${ns} not accessible to a route in namespace "${route.ns}" (missing a ReferenceGrant?)` };
    const svc = S.services[ns + '/' + ref.name];
    if (!svc) return { err: 'BackendNotFound', message: `backend(${ref.name}.${ns}.svc.cluster.local) not found` };
    return { svc };
  }
  function resolveRefs(r) {
    for (const rule of (r.spec.rules || [])) {
      for (const f of rule.filters || []) {
        if (f.type === 'ExtensionRef') return { ok: false, reason: 'InvalidKind', message: 'unsupported filter type "ExtensionRef"' };
        if (f.type === 'RequestMirror' && f.requestMirror && f.requestMirror.backendRef) { const x = resolveBackendRef(r, f.requestMirror.backendRef); if (x.err) return { ok: false, reason: x.err, message: x.message }; }
      }
      for (const b of rule.backendRefs || []) {
        const x = resolveBackendRef(r, b);
        if (x.err) return { ok: false, reason: x.err, message: x.message };
        for (const f of b.filters || []) if (f.type === 'ExtensionRef') return { ok: false, reason: 'InvalidKind', message: 'unsupported filter type "ExtensionRef"' };
      }
    }
    return { ok: true, reason: 'ResolvedRefs', message: 'All references resolved' };
  }

  function clusterView() {
    const active = controllerActive();
    const rAt = readyAt();
    const cv = { active, gws: {}, gwList: [], routes: {}, routeList: [], derived: { pods: [], services: [] }, classReady: false, classCreated: S.istio ? S.istio.at + 8000 : 0 };
    cv.classReady = !!(S.crds && S.istio && now() >= S.istio.at + ISTIO_READY_MS);
    const usedIps = new Set();
    for (const [key, g] of Object.entries(S.gateways)) {
      const managed = active && g.spec.gatewayClassName === 'istio';
      const since = managed ? Math.max(g.created, rAt) + GW_SYNC_MS : null;
      const programmed = managed && now() >= since;
      const gv = { key, g, managed, programmed, since, listeners: [], svcName: g.name + '-istio' };
      usedIps.add(g.ip);
      const ls = (g.spec.listeners || []).map((l) => {
        const proto = l.protocol || 'HTTP';
        const base = PROTO_KINDS[proto] || [];
        let kinds = base;
        let badKinds = false;
        const ak = l.allowedRoutes && l.allowedRoutes.kinds;
        if (ak && ak.length) { kinds = base.filter((k) => ak.some((x) => x.kind === k)); badKinds = ak.some((x) => !base.includes(x.kind)); }
        return { name: l.name, port: l.port, protocol: proto, hostname: l.hostname || '', tls: l.tls || null, allowed: l.allowedRoutes || {}, baseKinds: base, kinds, badKinds, attached: [], broken: false, udp: proto === 'UDP' };
      });
      // conflicts
      for (const l of ls) {
        const same = ls.filter((o) => o !== l && o.port === l.port && o.udp === l.udp);
        if (same.some((o) => o.protocol !== l.protocol)) { l.conflict = 'ProtocolConflict'; l.conflictMsg = 'Protocol conflict: multiple protocols on the same port'; l.broken = true; }
        else if (same.some((o) => (o.hostname || '') === (l.hostname || ''))) { l.conflict = 'HostnameConflict'; l.conflictMsg = 'Hostname conflict, multiple listeners with the same hostname on the same port'; l.broken = true; }
      }
      // certificate references
      for (const l of ls) {
        l.refErr = null;
        if (l.badKinds) l.refErr = { reason: 'InvalidRouteKinds', message: 'Invalid route kinds' };
        if ((l.protocol === 'HTTPS' || (l.protocol === 'TLS' && l.tls && l.tls.mode === 'Terminate'))) {
          const refs = (l.tls && l.tls.certificateRefs) || [];
          if (!refs.length) l.refErr = { reason: 'InvalidCertificateRef', message: 'no certificate refs specified' };
          for (const c of refs) {
            const cns = c.namespace || g.ns;
            if (cns !== g.ns && !grantAllows('Gateway', g.ns, cns, 'Secret', c.name)) { l.refErr = { reason: 'RefNotPermitted', message: `certificateRef Secret/${cns}/${c.name} not accessible to a Gateway in namespace "${g.ns}" (missing a ReferenceGrant?)` }; break; }
            if ((c.kind || 'Secret') !== 'Secret') { l.refErr = { reason: 'InvalidCertificateRef', message: `unsupported certificate reference kind ${c.kind}` }; break; }
            if (!S.secrets[cns + '/' + c.name]) { l.refErr = { reason: 'InvalidCertificateRef', message: `invalid certificate reference /Secret/${c.name}, secret ${cns}/${c.name} not found` }; break; }
          }
        }
      }
      gv.listeners = ls;
      cv.gws[key] = gv;
      cv.gwList.push(gv);
    }
    cv.gwList.sort((a, b) => a.g.created - b.g.created);

    for (const [key, r] of Object.entries(S.routes)) {
      const rv = { key, r, parents: [], resolved: resolveRefs(r), hasStatus: false, since: null, implemented: IMPLEMENTED.includes(r.kind) };
      cv.routes[key] = rv; cv.routeList.push(rv);
      if (!rv.implemented || !active) continue;
      rv.since = Math.max(r.created, rAt) + ROUTE_SYNC_MS;
      if (now() < rv.since) continue;
      for (const pr of r.spec.parentRefs || []) {
        const kind = pr.kind || 'Gateway', group = pr.group === undefined ? GROUP : pr.group;
        if (kind !== 'Gateway' || group !== GROUP) continue;       // GAMMA / mesh parents are not handled here
        const pns = pr.namespace || r.ns;
        const parentRef = { group: GROUP, kind: 'Gateway', name: pr.name };
        if (pr.namespace) parentRef.namespace = pr.namespace;
        if (pr.sectionName) parentRef.sectionName = pr.sectionName;
        if (pr.port) parentRef.port = pr.port;
        const p = { parentRef, gwKey: pns + '/' + pr.name, accepted: false, reason: '', message: '', attached: [], status: true };
        const gv = cv.gws[p.gwKey];
        if (!gv) { p.reason = 'NoMatchingParent'; p.message = `parent gateway "${pr.name}" not found`; }
        else if (!gv.managed) continue;
        else {
          let lsts = gv.listeners.filter((l) => !l.broken && (!pr.sectionName || l.name === pr.sectionName) && (!pr.port || l.port === pr.port));
          const compat = lsts.filter((l) => l.baseKinds.includes(r.kind));
          if (!compat.length) {
            p.reason = 'NoMatchingParent';
            p.message = pr.sectionName && !gv.listeners.some((l) => l.name === pr.sectionName) ? `no listener named "${pr.sectionName}" found on gateway "${pr.name}"` : `no listener with a protocol compatible with ${r.kind} found on gateway "${pr.name}"`;
          } else {
            const kindOk = compat.filter((l) => l.kinds.includes(r.kind));
            const nsOk = kindOk.filter((l) => nsAllowed(l, gv.g.ns, r.ns));
            if (!nsOk.length) {
              p.reason = 'NotAllowedByListeners';
              const host = (kindOk[0] || compat[0]).hostname;
              p.message = !kindOk.length ? `kind ${GROUP}/${ROUTE_VER[r.kind]}/${r.kind} is not allowed` : /^(HTTPRoute|GRPCRoute)$/.test(r.kind)
                ? `hostnames matched parent hostname "${host}", but namespace "${r.ns}" is not allowed by the parent`
                : `kind ${GROUP}/${ROUTE_VER[r.kind]}/${r.kind} is not allowed; hostnames matched parent hostname "${host}", but namespace "${r.ns}" is not allowed by the parent`;
            } else {
              const hs = (r.kind === 'TCPRoute' || r.kind === 'UDPRoute') ? [] : (r.spec.hostnames || []);
              const hostOk = nsOk.filter((l) => !hs.length || !l.hostname || hs.some((h) => intersectHosts(h, l.hostname)));
              if (!hostOk.length) { p.reason = 'NoMatchingListenerHostname'; p.message = `no hostnames matched parent hostname "${nsOk[0].hostname}"`; }
              else { p.accepted = true; p.reason = 'Accepted'; p.message = 'Route was valid'; p.attached = hostOk.map((l) => l.name); for (const l of hostOk) l.attached.push(key); }
            }
          }
        }
        rv.parents.push(p);
      }
      rv.hasStatus = rv.parents.length > 0;
    }
    cv.routeList.sort((a, b) => a.r.created - b.r.created || a.key.localeCompare(b.key));

    // derived objects: istiod, gateway services + envoy pods, kube-system, default/kubernetes
    const D = cv.derived;
    for (const [name, ip, node] of KUBE_SYSTEM_PODS) D.pods.push(mkPod('kube-system', name, { ip, node, kind: 'system', labels: { 'k8s-app': name.replace(/-[a-z0-9]{5}$/, '').replace(/-kind-control-plane$/, '') }, containers: ['main'], created: S.namespaces['kube-system'].created, base: true }));
    D.services.push({ ns: 'default', name: 'kubernetes', type: 'ClusterIP', clusterIP: '10.96.0.1', selector: {}, ports: [{ name: 'https', port: 443, targetPort: 6443, protocol: 'TCP' }], created: S.namespaces.default.created, system: true });
    D.services.push({ ns: 'kube-system', name: 'kube-dns', type: 'ClusterIP', clusterIP: '10.96.0.10', selector: { 'k8s-app': 'kube-dns' }, ports: [{ name: 'dns', port: 53, targetPort: 53, protocol: 'UDP' }, { name: 'dns-tcp', port: 53, targetPort: 53, protocol: 'TCP' }, { name: 'metrics', port: 9153, targetPort: 9153, protocol: 'TCP' }], created: S.namespaces.default.created, system: true });
    if (S.istio) {
      D.pods.push(mkPod('istio-system', ISTIOD, { ip: '10.244.2.5', node: 'kind-worker2', kind: 'istiod', labels: { app: 'istiod', 'istio.io/rev': 'default' }, containers: ['discovery'], created: S.istio.at, istiod: true }));
      D.services.push({ ns: 'istio-system', name: 'istiod', type: 'ClusterIP', clusterIP: '10.96.131.58', selector: { app: 'istiod' }, ports: [{ name: 'grpc-xds', port: 15010, targetPort: 15010, protocol: 'TCP' }, { name: 'https-dns', port: 15012, targetPort: 15012, protocol: 'TCP' }, { name: 'https-webhook', port: 443, targetPort: 15017, protocol: 'TCP' }, { name: 'http-monitoring', port: 15014, targetPort: 15014, protocol: 'TCP' }], created: S.istio.at, system: true });
    }
    for (const gv of cv.gwList) {
      if (!gv.programmed) continue;
      const g = gv.g;
      const ports = [{ name: 'status-port', port: 15021, targetPort: 15021, nodePort: 31961, protocol: 'TCP' }];
      for (const l of gv.listeners) {
        const pr = l.udp ? 'UDP' : 'TCP';
        if (!ports.some((p) => p.port === l.port && p.protocol === pr)) ports.push({ name: l.name, port: l.port, targetPort: l.port, nodePort: NODE_PORTS[l.port] || 30000 + (l.port * 7 % 2700), protocol: pr });
      }
      gv.svcPorts = ports;
      D.services.push({ ns: g.ns, name: gv.svcName, type: 'LoadBalancer', clusterIP: g.name === 'kiada' ? '10.96.155.20' : newClusterIP(g.name + '-istio'), externalIP: g.ip, selector: { 'istio.io/gateway-name': g.name }, ports, created: g.created, gwKey: gv.key, system: true });
      const podName = g.name === 'kiada' ? 'kiada-istio-86c59d8dd6-jfrnv' : `${g.name}-istio-${rid(g.name, 10)}-${rid(g.name + 'p', 5)}`;
      const ipOctet = g.name === 'kiada' ? 9 : 30 + (hash(g.name) % 60);
      gv.pod = mkPod(g.ns, podName, { ip: `10.244.${g.name === 'kiada' ? 1 : 2}.${ipOctet}`, node: g.name === 'kiada' ? 'kind-worker' : 'kind-worker2', kind: 'envoy', labels: { 'istio.io/gateway-name': g.name, 'gateway.networking.k8s.io/gateway-name': g.name, 'service.istio.io/canonical-name': g.name + '-istio' }, containers: ['istio-proxy'], created: g.created, always: true, gwKey: gv.key });
      D.pods.push(gv.pod);
    }
    return cv;
  }
  const allPods = (cv) => [...Object.values(S.pods), ...cv.derived.pods];
  const allServices = (cv) => [...Object.values(S.services), ...cv.derived.services];

  // ---------- data plane ----------
  const QUOTES = [
    'A Service gives pods one address. A Gateway gives Services one front door.',
    'A Route without a parent is a letter without an address.',
    'Terminate TLS at the gateway, or let it pass through. Decide on purpose.',
    'An HTTPRoute only matches what its Gateway listener lets in.',
    'Weights are relative: 9 and 1 is the same as 90 and 10.',
    'Exact beats prefix beats regex beats "/". Longest wins within a type.',
    'ReferenceGrants live with the referent, not the referrer.',
    'Istio does not do UDPRoute. Check the status, there is none.',
  ];
  const QUESTIONS = [
    { text: 'Which condition tells you a Route was accepted by its parent Gateway?', answers: ['Programmed', 'Accepted', 'Ready'], correctAnswerIndex: 1 },
    { text: 'Which kind routes traffic on a TLS listener in Passthrough mode?', answers: ['HTTPRoute', 'TLSRoute', 'GRPCRoute'], correctAnswerIndex: 1 },
    { text: 'Where does a ReferenceGrant live?', answers: ['With the Route', 'With the Gateway', 'In the namespace of the referent'], correctAnswerIndex: 2 },
  ];
  const PROTO_FILE = `syntax = "proto3";

package yages;

option go_package = "github.com/mhausenblas/yages/pkg/yages";

service Echo {
  rpc Ping(Empty) returns (Content) {}
  rpc Reverse(Content) returns (Content) {}
}

message Empty {}

message Content {
  string text = 1;
}`;

  function escapeHdr(h) { return String(h); }
  function findHdr(list, name) { const ln = name.toLowerCase(); return list.findIndex(([k]) => k.toLowerCase() === ln); }
  function setHdr(list, name, value) { const i = findHdr(list, name); if (i >= 0) list[i][1] = value; else list.push([name, value]); }
  function addHdr(list, name, value) { const i = findHdr(list, name); if (i >= 0) list[i][1] = list[i][1] + ', ' + value; else list.push([name, value]); }
  function delHdr(list, name) { const i = findHdr(list, name); if (i >= 0) list.splice(i, 1); }
  function headerDiff(orig, fin) {
    const o = new Map(orig.map(([k, v]) => [k.toLowerCase(), [k, v]]));
    const parts = [];
    for (const [k, v] of fin) { const lk = k.toLowerCase(); if (lk === 'host') continue; if (!o.has(lk) || o.get(lk)[1] !== v) parts.push(`${k}=${v}`); }
    for (const [lk, [k]] of o) if (lk !== 'host' && findHdr(fin, k) < 0) parts.push(`${k}=<removed>`);
    return parts;
  }

  // Which rule of which HTTPRoute wins? Gateway API precedence.
  function matchEntry(m, req) {
    const path = m.path || { type: 'PathPrefix', value: '/' };
    const type = path.type || 'PathPrefix', val = path.value === undefined ? '/' : path.value;
    let rank, plen;
    if (type === 'Exact') { if (req.path !== val) return null; rank = 4; plen = val.length; }
    else if (type === 'RegularExpression') { if (!fullMatch(val, req.path)) return null; rank = 2; plen = val.length; }
    else {
      const r = splitPath(val), q = splitPath(req.path);
      if (r.length > q.length) return null;
      for (let i = 0; i < r.length; i++) if (r[i] !== q[i]) return null;
      rank = val === '/' || val === '' ? 1 : 3; plen = val.length;
    }
    if (m.method && m.method.toUpperCase() !== (req.method || 'GET').toUpperCase()) return null;
    for (const h of m.headers || []) {
      const i = findHdr(req.headers, h.name);
      if (i < 0) return null;
      const v = req.headers[i][1];
      if ((h.type || 'Exact') === 'Exact' ? v !== h.value : !fullMatch(h.value, v)) return null;
    }
    for (const q of m.queryParams || []) {
      const e = (req.query || []).find(([k]) => k === q.name);
      if (!e) return null;
      if ((q.type || 'Exact') === 'Exact' ? e[1] !== q.value : !fullMatch(q.value, e[1])) return null;
    }
    return [rank, plen, m.method ? 1 : 0, (m.headers || []).length, (m.queryParams || []).length];
  }
  function cmpTuple(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
  // routes: array of {r (record), key}; returns the winning {route, rule, ruleIdx, match, rank} or null
  function selectRoute(routes, listener, req) {
    const entries = [];
    for (const rv of routes) {
      const hs = (rv.r.spec.hostnames && rv.r.spec.hostnames.length) ? rv.r.spec.hostnames : ['*'];
      for (const h of hs) { const eff = intersectHosts(h, listener ? listener.hostname : ''); if (eff) entries.push({ rv, host: eff }); }
    }
    let best = -1;
    for (const e of entries) { e.sc = hostMatchScore(e.host, req.host); best = Math.max(best, e.sc); }
    if (best < 0) return null;
    let win = null;
    for (const e of entries.filter((x) => x.sc === best)) {
      (e.rv.r.spec.rules || []).forEach((rule, ri) => {
        for (const m of (rule.matches && rule.matches.length ? rule.matches : [{}])) {
          const rank = matchEntry(m, req);
          if (!rank) continue;
          const cand = { route: e.rv, rule, ruleIdx: ri, match: m, rank };
          if (!win) { win = cand; continue; }
          const c = cmpTuple(rank, win.rank);
          if (c > 0) win = cand;
          else if (c === 0) {
            if (cand.route.r.created < win.route.r.created) win = cand;
            else if (cand.route.r.created === win.route.r.created && cand.route !== win.route && cand.route.key < win.route.key) win = cand;
          }
        }
      });
    }
    return win;
  }
  function pickWeighted(refs) {
    const ws = refs.map((r) => (r.weight === undefined || r.weight === null ? 1 : Number(r.weight)));
    const tot = ws.reduce((a, b) => a + b, 0);
    if (tot <= 0) return null;
    let x = Math.random() * tot;
    for (let i = 0; i < refs.length; i++) { if (ws[i] <= 0) continue; x -= ws[i]; if (x < 0) return refs[i]; }
    for (let i = refs.length - 1; i >= 0; i--) if (ws[i] > 0) return refs[i];
    return null;
  }
  function pickPod(svc, cv) {
    const eps = endpointsOf(svc, allPods(cv));
    if (!eps.length) return null;
    const k = svc.ns + '/' + svc.name;
    S.rr[k] = ((S.rr[k] === undefined ? -1 : S.rr[k]) + 1) % eps.length;
    return eps[S.rr[k]];
  }
  const respHdrs = (extra) => extra;
  const STATUS_TEXT = { 200: 'OK', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' };

  function kiadaBody(pod, req, hdrs, scheme) {
    const L = [`KUBERNETES IN ACTION DEMO APPLICATION v${pod.version}`, '', '==== REQUEST INFO',
      `Request processed by Kiada ${pod.version} running in pod "${pod.name}" on node "${pod.node}".`,
      `Pod hostname: ${pod.name}; Pod IP: ${pod.ip}; Node IP: ${NODE_IPS[pod.node] || '172.18.0.3'}; Client IP: ::ffff:${req.clientIp}`,
      `Request: ${req.method} ${req.path}${req.rawQuery ? '?' + req.rawQuery : ''} HTTP/1.1`, 'HTTP request headers:'];
    for (const [k, v] of hdrs) L.push(`  ${k}: ${v}`);
    L.push(`  X-Forwarded-For: ${CLIENT_IP}`, `  X-Forwarded-Proto: ${scheme}`, `  X-Request-Id: ${rid(String(now()) + req.path, 8, '0123456789abcdef')}-0c1d-4e5f-8a9b-${rid(pod.name + req.path, 12, '0123456789abcdef')}`, '  X-Envoy-Attempt-Count: 1');
    return L.join('\n');
  }

  function podLog(pod, line, note) {
    const k = pod.ns + '/' + pod.name;
    const a = S.plog[k] || (S.plog[k] = []);
    a.push({ line, note: note || '' });
    if (a.length > 60) a.splice(0, 20);
  }
  function gwLog(gv, line) {
    const a = S.glog[gv.key] || (S.glog[gv.key] = []);
    a.push(line);
    if (a.length > 80) a.splice(0, 20);
  }

  // Deliver a request to a backend Service; returns {status, headers, body, pod, port}
  function callBackend(svc, port, req, hdrs, cv, opts) {
    const sp = svc.ports.find((p) => p.port === port);
    const pod = pickPod(svc, cv);
    if (!pod || !sp) return { status: 503, body: 'no healthy upstream', ctype: 'text/plain', svc, port, noPod: !pod, noPort: !sp };
    const base = { svc, port, pod, sp };
    if (sp.targetPort === 8443) return { ...base, status: 503, body: 'upstream connect error or disconnect/reset before headers. reset reason: connection termination', ctype: 'text/plain' };
    if (pod.kind === 'kiada') {
      const note = req.note;
      podLog(pod, `${tsMs()} Received request for ${req.path} from ::ffff:${req.clientIp}`, note);
      if (opts.mirror) return { ...base, status: 200, body: '', ctype: 'text/plain' };
      return { ...base, status: 200, ctype: 'text/plain', body: kiadaBody(pod, req, hdrs, opts.scheme || 'http') };
    }
    if (pod.kind === 'quote') {
      podLog(pod, `${req.clientIp} - - [${tsMs()}] "${req.method} ${req.path} HTTP/1.1" 200 ${60 + (hash(pod.name) % 30)} "-" "curl/8.5.0"`, '');
      return { ...base, status: 200, ctype: 'text/plain', body: `"${QUOTES[(hash(pod.name) + (S.rr.__q = (S.rr.__q || 0) + 1)) % QUOTES.length]}"\n   - quote service, pod ${pod.name}` };
    }
    if (pod.kind === 'quiz') {
      const i = (S.rr.__z = ((S.rr.__z === undefined ? -1 : S.rr.__z) + 1)) % QUESTIONS.length;
      podLog(pod, `${tsMs()} GET ${req.path} 200`, '');
      return { ...base, status: 200, ctype: 'application/json', body: JSON.stringify({ id: i + 1, ...QUESTIONS[i], servedBy: pod.name }, null, 2) };
    }
    if (pod.kind === 'test') return { ...base, status: 503, ctype: 'text/plain', body: 'upstream connect error or disconnect/reset before headers. reset reason: protocol error' };
    return { ...base, status: 200, ctype: 'text/plain', body: 'ok' };
  }

  // One HTTP exchange through a gateway listener (after TCP/TLS). Returns a full response description.
  function httpExchange(gv, lst, req, cv, side) {
    const out = { status: 404, headers: [], body: '', route: null, rule: null, steps: [] };
    const routes = lst ? cv.routeList.filter((rv) => rv.r.kind === 'HTTPRoute' && rv.parents.some((p) => p.gwKey === gv.key && p.accepted && p.attached.includes(lst.name))) : [];
    const sel = lst ? selectRoute(routes, lst, req) : null;
    const t0 = now();
    const finish = (o) => {
      o.upstreamMs = o.upstreamMs === undefined ? (1 + (hash(req.path + t0) % 6)) : o.upstreamMs;
      if (side) {
        const flag = o.status === 404 ? 'NR' : o.status === 503 ? 'UF' : o.status === 500 ? 'NC' : '-';
        const tgt = o.backend ? `"${o.backend.pod ? o.backend.pod.ip + ':' + o.backend.sp.targetPort : '-'}" outbound|${o.backend.port}||${o.backend.svc.name}.${o.backend.svc.ns}.svc.cluster.local` : '"-" - -';
        const gp = gv.pod ? gv.pod.ip : '10.244.1.9';
        gwLog(gv, `[${tsMs()}] "${req.method} ${req.path}${req.rawQuery ? '?' + req.rawQuery : ''} HTTP/1.1" ${o.status} ${flag === '-' ? '-' : flag} via_upstream - "-" 0 ${(o.body || '').length} ${o.upstreamMs} ${o.upstreamMs} "${CLIENT_IP}" "curl/8.5.0" "${rid(req.path + t0, 8, '0123456789abcdef')}-0c1d-4e5f-8a9b-${rid(req.path, 12, '0123456789abcdef')}" "${req.host}" ${tgt} ${gp}:${40000 + (hash(String(t0)) % 9000)} ${gp}:${req.port} ${CLIENT_IP}:${50000 + (hash(String(t0 + 1)) % 9000)} - -`);
      }
      return o;
    };
    if (!sel) return finish({ ...out, status: 404, body: '' });
    out.route = sel.route; out.rule = sel.rule; out.ruleIdx = sel.ruleIdx;
    const rule = sel.rule, r = sel.route.r;
    // pick backend first (backend-level filters)
    const refs = (rule.backendRefs || []);
    const ref = refs.length ? pickWeighted(refs) : null;
    const filters = [...(rule.filters || []), ...((ref && ref.filters) || [])];
    const hdrs = req.headers.map((h) => [h[0], h[1]]);
    let host = req.host, path = req.path;
    const respMods = [];
    const mirrors = [];
    let redirect = null, extension = false;
    for (const f of filters) {
      if (f.type === 'RequestHeaderModifier' && f.requestHeaderModifier) {
        const m = f.requestHeaderModifier;
        for (const x of m.set || []) setHdr(hdrs, x.name, x.value);
        for (const x of m.add || []) addHdr(hdrs, x.name, x.value);
        for (const x of m.remove || []) delHdr(hdrs, x);
      } else if (f.type === 'ResponseHeaderModifier' && f.responseHeaderModifier) respMods.push(f.responseHeaderModifier);
      else if (f.type === 'URLRewrite' && f.urlRewrite) {
        const u = f.urlRewrite;
        if (u.hostname) { host = u.hostname; setHdr(hdrs, 'Host', u.hostname); }
        if (u.path) {
          if (u.path.type === 'ReplaceFullPath') path = u.path.replaceFullPath || '/';
          else if (u.path.type === 'ReplacePrefixMatch') {
            const mp = sel.match.path;
            if (mp && (mp.type || 'PathPrefix') === 'PathPrefix') {
              const prefix = (mp.value || '/').replace(/\/+$/, '');
              const rest = path.slice(prefix.length);
              const repl = (u.path.replacePrefixMatch || '/').replace(/\/+$/, '');
              path = (repl + rest) || '/';
              if (path[0] !== '/') path = '/' + path;
            }
          }
        }
      } else if (f.type === 'RequestRedirect' && f.requestRedirect) redirect = f.requestRedirect;
      else if (f.type === 'RequestMirror' && f.requestMirror) mirrors.push(f.requestMirror.backendRef);
      else if (f.type === 'ExtensionRef') extension = true;
    }
    if (redirect) {
      const rr = redirect;
      const scheme = rr.scheme || req.scheme;
      const rhost = rr.hostname || req.host;
      let port = rr.port;
      if (!port) port = rr.scheme ? (rr.scheme === 'https' ? 443 : 80) : req.port;
      let rpath = req.path;
      if (rr.path) {
        if (rr.path.type === 'ReplaceFullPath') rpath = rr.path.replaceFullPath || '/';
        else if (rr.path.type === 'ReplacePrefixMatch' && sel.match.path) { const prefix = (sel.match.path.value || '/').replace(/\/+$/, ''); rpath = ((rr.path.replacePrefixMatch || '/').replace(/\/+$/, '') + req.path.slice(prefix.length)) || '/'; }
      }
      const dflt = scheme === 'https' ? 443 : 80;
      const loc = `${scheme}://${rhost}${Number(port) === dflt ? '' : ':' + port}${rpath}${req.rawQuery ? '?' + req.rawQuery : ''}`;
      const code = Number(rr.statusCode || 302);
      return finish({ ...out, status: code, redirect: true, headers: [['location', loc]], body: '', upstreamMs: 0 });
    }
    const unresolved = extension || !ref || (() => { const x = resolveBackendRef(r, ref); return !!x.err; })();
    if (unresolved) return finish({ ...out, status: 500, body: '', unresolved: true, reason: extension ? 'ExtensionRef' : !ref ? 'no backend' : resolveBackendRef(r, ref).err });
    const x = resolveBackendRef(r, ref);
    const pathBeforeNote = req.path;
    const diffs = headerDiff(req.headers, hdrs);
    const modified = host !== req.host || diffs.length || path !== pathBeforeNote;
    const note = (host !== req.host || diffs.length) ? `    host=${host}${diffs.length ? '; ' + diffs.join('; ') : ''}` : '';
    const breq = { ...req, path, host, note: modified ? note : '' };
    const res = callBackend(x.svc, ref.port, breq, hdrs, cv, { scheme: req.scheme });
    for (const m of mirrors) {
      const mx = resolveBackendRef(r, m);
      if (!mx.err) callBackend(mx.svc, m.port, { ...breq, note }, hdrs, cv, { mirror: true, scheme: req.scheme });
    }
    let rh = [['content-type', res.ctype || 'text/plain'], ['date', httpDate()], ['content-length', String(res.body.length)]];
    if (res.status === 200 || res.status === 503) rh.push(['x-envoy-upstream-service-time', String(1 + (hash(req.path + now()) % 6))]);
    rh.push(['server', 'istio-envoy']);
    for (const m of respMods) {
      for (const s of m.set || []) setHdr(rh, s.name, s.value);
      for (const a of m.add || []) addHdr(rh, a.name, a.value);
      for (const d of m.remove || []) delHdr(rh, d);
    }
    return finish({ ...out, status: res.status, headers: rh, body: res.body, backend: res, upstreamMs: undefined, fromHeaders: true });
  }

  // TCP: returns {ok, reply|null, why}
  function tcpExchange(gv, lst, text, cv) {
    const routes = cv.routeList.filter((rv) => rv.r.kind === 'TCPRoute' && rv.parents.some((p) => p.gwKey === gv.key && p.accepted && p.attached.includes(lst.name)));
    if (!routes.length) return { refused: true };
    const rv = routes[0];
    const rule = (rv.r.spec.rules || [])[0] || {};
    const ref = pickWeighted(rule.backendRefs || []);
    if (!ref) return { refused: true };
    const x = resolveBackendRef(rv.r, ref);
    if (x.err) return { closed: true, why: x.message };
    const pod = pickPod(x.svc, cv);
    const sp = x.svc.ports.find((p) => p.port === ref.port);
    if (!pod || !sp) return { closed: true, why: 'no healthy upstream' };
    if (pod.kind === 'test' && sp.targetPort === 2000) {
      podLog(pod, `${tsMs()} tcp: connection from ${gv.pod ? gv.pod.ip : '10.244.2.31'}`, '');
      return { reply: 'You said: ' + text, pod };
    }
    return { closed: true, why: 'backend does not speak this protocol', pod };
  }

  // Passthrough: route by SNI through TLSRoutes; returns {status..} like httpExchange or {refused}
  function passthrough(gv, lst, req, cv, side) {
    const routes = cv.routeList.filter((rv) => rv.r.kind === 'TLSRoute' && rv.parents.some((p) => p.gwKey === gv.key && p.accepted && p.attached.includes(lst.name)));
    const sel = selectRoute(routes, lst, { ...req, path: '/', headers: [] });
    if (!sel) return { refused: true };
    const rule = sel.rule;
    const ref = pickWeighted(rule.backendRefs || []);
    if (!ref) return { refused: true };
    const x = resolveBackendRef(sel.route.r, ref);
    if (x.err) return { refused: true };
    const pod = pickPod(x.svc, cv);
    const sp = x.svc.ports.find((p) => p.port === ref.port);
    if (!pod || !sp) return { refused: true, noPod: true };
    if (sp.targetPort !== 8443 || pod.kind !== 'kiada') return { notTls: true, pod };
    const hdrs = req.headers.map((h) => [h[0], h[1]]);
    podLog(pod, `${tsMs()} Received request for ${req.path} from ::ffff:127.0.0.1`, '');
    if (side) gwLog(gv, `[${tsMs()}] - - - - "-" "-" "-" "-" ${req.host} outbound|${ref.port}||${x.svc.name}.${x.svc.ns}.svc.cluster.local ${gv.pod ? gv.pod.ip : '10.244.1.9'}:${req.port} ${CLIENT_IP} (SNI ${req.host})`);
    const body = kiadaBody(pod, { ...req, clientIp: '127.0.0.1' }, hdrs, 'https');
    return { status: 200, headers: [['content-type', 'text/plain'], ['date', httpDate()], ['content-length', String(body.length)], ['x-envoy-upstream-service-time', '2'], ['server', 'envoy']], body, backend: { pod, svc: x.svc, port: ref.port, sp }, passthrough: true };
  }

  // convenience for widgets: simulate an HTTP request against a gateway listener without a shell
  function sendHttp(o, side) {
    const cv = clusterView();
    const gv = o.gateway ? cv.gws[o.gateway.includes('/') ? o.gateway : NS + '/' + o.gateway] : cv.gwList.find((g) => g.programmed);
    if (!gv || !gv.programmed) return { refused: true };
    const port = o.port || 80;
    const lst = gv.listeners.find((l) => l.port === port && !l.broken && (l.protocol === 'HTTP' || l.protocol === 'HTTPS') && hostMatchScore(l.hostname, o.host) > 0);
    const req = { scheme: o.scheme || 'http', host: (o.host || '').toLowerCase(), port, path: o.path || '/', rawQuery: o.rawQuery || '', query: o.query || [], method: (o.method || 'GET').toUpperCase(), headers: o.headers || [['Host', o.host || ''], ['User-Agent', 'curl/8.5.0'], ['Accept', '*/*']], clientIp: gv.pod ? gv.pod.ip : '10.244.1.9' };
    const r = httpExchange(gv, lst, req, cv, !!side);
    if (side) save();
    return r;
  }

  // ---------- applying manifests ----------
  const nsExists = (ns) => !!S.namespaces[ns];
  const singular = (kind) => kind.toLowerCase();
  function nameOf(kind, name) { return `${singular(kind)}.${GROUP}/${name}`; }
  function newIp(name) {
    const used = new Set(Object.values(S.gateways).map((g) => g.ip));
    if (FIXED_GW_IPS[name] && !used.has(FIXED_GW_IPS[name])) return FIXED_GW_IPS[name];
    for (let i = 203; i < 250; i++) { const ip = '172.18.255.' + i; if (!used.has(ip)) return ip; }
    return '172.18.255.250';
  }

  function applyDoc(doc, file, opts = {}) {
    const kind = doc.kind, md = doc.metadata || {}, name = md.name;
    const t = opts.at || now();
    if (!kind || !name) return { err: `error: error validating "${file}": error validating data: [missing kind or metadata.name]` };
    const ns = md.namespace || opts.ns || S.curNs || NS;
    if (kind === 'Namespace') {
      const ex = S.namespaces[name];
      if (ex) {
        if (md.labels && JSON.stringify(Object.assign({}, ex.labels, md.labels)) !== JSON.stringify(ex.labels)) { Object.assign(ex.labels, md.labels); return { msg: `namespace/${name} configured` }; }
        return { msg: `namespace/${name} unchanged` };
      }
      S.namespaces[name] = { labels: clone(md.labels || {}), created: t };
      return { msg: `namespace/${name} created` };
    }
    if (kind === 'Pod' || kind === 'Service') {
      if (!nsExists(ns)) return { err: `Error from server (NotFound): error when creating "${file}": namespaces "${ns}" not found` };
      const key = ns + '/' + name;
      if (kind === 'Pod') {
        if (S.pods[key]) return { msg: `pod/${name} unchanged` };
        const spec = doc.spec || {};
        const cs = spec.containers || [];
        const img = cs.map((c) => c.image || '').join(' ');
        let podKind = 'other', version = '0.5';
        if (/kiada/.test(img)) { podKind = 'kiada'; const m = (cs.find((c) => /kiada/.test(c.image || '')) || {}).image || ''; version = (m.split(':')[1]) || 'latest'; }
        else if (/quote/.test(img)) podKind = 'quote';
        else if (/quiz/.test(img)) podKind = 'quiz';
        else if (name === 'test' || /yages/.test(img)) podKind = 'test';
        const { ip, node } = nextPodIp();
        S.pods[key] = mkPod(ns, name, { ip, node, kind: podKind, version, labels: clone(md.labels || {}), containers: cs.map((c) => c.name), created: t, imgs: cs.map((c) => c.image) });
        delete S.plog[key];
        return { msg: `pod/${name} created` };
      }
      const spec = doc.spec || {};
      const ex = S.services[key];
      const ports = (spec.ports || []).map((p) => ({ name: p.name, port: p.port, targetPort: p.targetPort || p.port, protocol: p.protocol || 'TCP' }));
      const raw = JSON.stringify([spec.selector || {}, ports]);
      if (ex) {
        if (ex.base || ex.raw === raw) return { msg: `service/${name} unchanged` };
        Object.assign(ex, { selector: clone(spec.selector || {}), ports, raw });
        return { msg: `service/${name} configured` };
      }
      S.services[key] = { ns, name, type: spec.type || 'ClusterIP', clusterIP: newClusterIP(key), selector: clone(spec.selector || {}), ports, created: t, raw };
      return { msg: `service/${name} created` };
    }
    if (kind === 'Secret') {
      const key = ns + '/' + name;
      if (S.secrets[key]) return { msg: `secret/${name} unchanged` };
      S.secrets[key] = { ns, name, type: doc.type || 'Opaque', created: t };
      return { msg: `secret/${name} created` };
    }
    if (kind === 'Gateway' || ROUTE_KINDS.includes(kind) || kind === 'ReferenceGrant') {
      if (!crdsInstalled()) return { err: `error: resource mapping not found for name: "${name}" namespace: "${md.namespace || ''}" from "${file}": no matches for kind "${kind}" in version "${doc.apiVersion}"\nensure CRDs are installed first`, hint: 'The Gateway API kinds are CRDs that Kubernetes does not ship. Install them first (section 13.1.3): kubectl apply -k github.com/kubernetes-sigs/gateway-api/config/crd/experimental' };
      if (!nsExists(ns)) return { err: `Error from server (NotFound): error when creating "${file}": namespaces "${ns}" not found`, hint: `Create the namespace first, e.g. apply the manifest that defines it.` };
      const rawSpec = doc.spec || {};
      const labels = md.labels || {};
      const raw = JSON.stringify([rawSpec, labels]);
      const spec = defaultSpec(kind, rawSpec);
      const msgName = nameOf(kind, name);
      if (kind === 'Gateway') {
        const key = ns + '/' + name, ex = S.gateways[key];
        if (ex) {
          if (ex.raw === raw) return { msg: `${msgName} unchanged` };
          Object.assign(ex, { spec, raw, labels: clone(labels), gen: ex.gen + 1, updated: t });
          return { msg: `${msgName} configured` };
        }
        S.gateways[key] = { ns, name, spec, raw, labels: clone(labels), gen: 1, created: t, updated: t, ip: newIp(name) };
        return { msg: `${msgName} created`, gw: S.gateways[key] };
      }
      if (kind === 'ReferenceGrant') {
        const key = ns + '/' + name, ex = S.grants[key];
        if (ex) {
          if (ex.raw === raw) return { msg: `${msgName} unchanged` };
          Object.assign(ex, { spec, raw, labels: clone(labels), gen: ex.gen + 1 });
          return { msg: `${msgName} configured` };
        }
        S.grants[key] = { ns, name, kind, spec, raw, labels: clone(labels), gen: 1, created: t, apiVersion: doc.apiVersion || GROUP + '/v1beta1' };
        return { msg: `${msgName} created` };
      }
      const key = kind + '/' + ns + '/' + name, ex = S.routes[key];
      if (ex) {
        if (ex.raw === raw) return { msg: `${msgName} unchanged` };
        Object.assign(ex, { spec, raw, labels: clone(labels), gen: ex.gen + 1, updated: t, apiVersion: doc.apiVersion || ex.apiVersion });
        return { msg: `${msgName} configured` };
      }
      S.routes[key] = { kind, ns, name, spec, raw, labels: clone(labels), gen: 1, created: t, updated: t, apiVersion: doc.apiVersion || `${GROUP}/${ROUTE_VER[kind]}` };
      return { msg: `${msgName} created`, route: S.routes[key] };
    }
    return { msg: `${kind.toLowerCase()}/${name} unchanged` };
  }

  function deleteNsContents(ns) {
    for (const k of Object.keys(S.pods)) if (S.pods[k].ns === ns) delete S.pods[k];
    for (const k of Object.keys(S.services)) if (S.services[k].ns === ns) delete S.services[k];
    for (const k of Object.keys(S.secrets)) if (S.secrets[k].ns === ns) delete S.secrets[k];
    for (const k of Object.keys(S.gateways)) if (S.gateways[k].ns === ns) delete S.gateways[k];
    for (const k of Object.keys(S.routes)) if (S.routes[k].ns === ns) delete S.routes[k];
    for (const k of Object.keys(S.grants)) if (S.grants[k].ns === ns) delete S.grants[k];
  }
  // delete one object; returns message or {err}
  function deleteObj(kind, name, ns, file) {
    const nf = (res) => ({ err: `Error from server (NotFound): ${file ? `error when deleting "${file}": ` : ''}${res} "${name}" not found` });
    if (kind === 'Namespace') {
      if (!S.namespaces[name]) return nf('namespaces');
      if (['default', 'kube-system', 'kube-public', 'kube-node-lease', NS].includes(name)) return { err: `Error from server (Forbidden): namespaces "${name}" is protected in this simulator`, hint: 'The rest of the chapter needs this namespace, so the simulator will not delete it. (reset gives you a fresh cluster.)' };
      deleteNsContents(name); delete S.namespaces[name];
      return { msg: `namespace "${name}" deleted` };
    }
    if (kind === 'Pod') {
      const k = ns + '/' + name, p = S.pods[k];
      if (!p) return nf('pods');
      if (p.base) return { msg: `pod "${name}" deleted`, hint: '(in this simulator the kiada suite pods come straight back)' };
      delete S.pods[k]; delete S.plog[k]; return { msg: `pod "${name}" deleted` };
    }
    if (kind === 'Service') {
      const k = ns + '/' + name;
      if (!S.services[k]) return nf('services');
      if (S.services[k].base) return { msg: `service "${name}" deleted`, hint: '(in this simulator the kiada suite services come straight back)' };
      delete S.services[k]; return { msg: `service "${name}" deleted` };
    }
    if (kind === 'Secret') { const k = ns + '/' + name; if (!S.secrets[k]) return nf('secrets'); delete S.secrets[k]; return { msg: `secret "${name}" deleted` }; }
    if (kind === 'Gateway') { const k = ns + '/' + name; if (!S.gateways[k]) return nf('gateways.' + GROUP); delete S.gateways[k]; return { msg: `${singular(kind)}.${GROUP} "${name}" deleted` }; }
    if (kind === 'ReferenceGrant') { const k = ns + '/' + name; if (!S.grants[k]) return nf('referencegrants.' + GROUP); delete S.grants[k]; return { msg: `referencegrant.${GROUP} "${name}" deleted` }; }
    if (ROUTE_KINDS.includes(kind)) { const k = kind + '/' + ns + '/' + name; if (!S.routes[k]) return nf(PLURAL[kind] + '.' + GROUP); delete S.routes[k]; return { msg: `${singular(kind)}.${GROUP} "${name}" deleted` }; }
    return nf(kind.toLowerCase() + 's');
  }

  function installCrds(t = now()) { S.crds = t; }
  function installIstio(t = now()) { S.istio = { at: t }; }

  // ---------- catch-up ----------
  const ORDER = ['13', '13.1', '13.1.1', '13.1.2', '13.1.3', '13.2', '13.2.1', '13.2.2', '13.2.3', '13.3', '13.3.1', '13.3.2', '13.3.3', '13.3.4', '13.4', '13.4.1', '13.4.2', '13.5', '13.5.1', '13.5.2', '13.5.3', '13.6', '13.6.1', '13.6.2', '13.7'];
  function catchup(section, ctx) {
    const idx = ORDER.indexOf(section);
    if (idx < 0) { ctx.err(`catchup: unknown section "${section}". Try one of: ${ORDER.slice(4).join(' ')}`); return; }
    const keepHistory = S.history;
    S = fresh(); S.history = keepHistory;
    const t0 = now() - 30 * 60e3;
    const done = [];
    const at = (n) => idx >= ORDER.indexOf(n);
    const apply = (file, mins) => { for (const d of YAML.parseAll(FILES[file])) { const r = applyDoc(d, file, { at: t0 + mins * 60e3, ns: NS }); if (r.err) done.push('! ' + r.err.split('\n')[0]); } done.push(`kubectl apply -f ${file}`); };
    if (at('13.2')) {
      installCrds(t0); done.push('kubectl apply -k github.com/kubernetes-sigs/gateway-api/config/crd/experimental');
      S.istioctl = true; done.push('curl -sL https://istio.io/downloadIstioctl | sh -');
      installIstio(t0 + 60e3); done.push('istioctl install -y --set profile=minimal');
    }
    if (at('13.2.3')) apply('gtw.kiada.yaml', 3);
    if (at('13.3.2')) apply('httproute.kiada.yaml', 5);
    if (at('13.3.3')) { apply('pod.kiada-new.yaml', 7); apply('httproute.kiada.splitting.yaml', 8); }
    if (at('13.3.4')) apply('httproute.api.yaml', 10);
    if (at('13.4')) apply('httproute.kiada.yaml', 12);
    if (at('13.4.2')) apply('gtw.kiada.tls-terminate.yaml', 14);
    if (at('13.5')) { apply('gtw.kiada.tls-passthrough.yaml', 16); apply('tlsroute.kiada.yaml', 17); }
    if (at('13.5.2')) { apply('podsvc.test.yaml', 19); apply('gtw.test.yaml', 20); apply('tcproute.test.yaml', 21); }
    if (at('13.5.3')) apply('udproute.test.yaml', 23);
    if (at('13.6')) apply('grpcroute.test.yaml', 25);
    if (at('13.6.2')) {
      apply('gtw.shared.yaml', 26); apply('httproute.cross-namespace-gateway.yaml', 27); apply('tcproute.cross-namespace-gateway.yaml', 28);
      S.namespaces[NS].labels['part-of'] = 'kiada'; done.push('kubectl label ns kiada part-of=kiada');
    }
    if (at('13.7')) { apply('httproute.cross-namespace-backend.yaml', 29); apply('referencegrant.from-httproutes-in-kiada-to-some-service.yaml', 30); }
    if (!done.length) done.push('fresh cluster: kiada, quote and quiz deployed; no Gateway API, no Istio');
    save();
    ctx.ok(`Cluster fast-forwarded to the start of ${section}:`);
    done.forEach((d) => ctx.out('  ✔ ' + d, 'dim'));
  }

  // ---------- shell parsing ----------
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
  function splitTop(line, sep) {
    const out = []; let cur = '', q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '\\' && i + 1 < line.length) { cur += c + line[++i]; continue; }
      if (c === sep && !(sep === '|' && line[i + 1] === '|') && !(sep === '|' && line[i - 1] === '|')) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter((s, i, a) => s || a.length === 1);
  }
  function flags(argv, spec) {
    const pos = [], f = {};
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      const eq = a.indexOf('=');
      const k = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
      if (spec.val[k]) { f[spec.val[k]] = eq > 0 && a.startsWith('--') ? a.slice(eq + 1) : argv[++i]; continue; }
      if (/^-o\w/.test(a) && spec.val['-o']) { f.out = a.slice(2); continue; }
      if (/^-n\w/.test(a) && spec.val['-n']) { f.ns = a.slice(2); continue; }
      if (spec.bool[k]) { f[spec.bool[k]] = true; continue; }
      if (a.startsWith('-') && a.length > 1) { f._unknown = (f._unknown || []).concat(a); continue; }
      pos.push(a);
    }
    return { pos, f };
  }

  // ---------- resource registry (kubectl get / describe / delete) ----------
  const RES = {
    po: 'pods', pod: 'pods', pods: 'pods', svc: 'services', service: 'services', services: 'services',
    ep: 'endpoints', endpoints: 'endpoints', endpointslice: 'endpointslices', endpointslices: 'endpointslices',
    secret: 'secrets', secrets: 'secrets', ns: 'namespaces', namespace: 'namespaces', namespaces: 'namespaces', no: 'nodes', node: 'nodes', nodes: 'nodes',
    gtw: 'gateways', gateway: 'gateways', gateways: 'gateways',
    gc: 'gatewayclasses', gatewayclass: 'gatewayclasses', gatewayclasses: 'gatewayclasses',
    httproute: 'httproutes', httproutes: 'httproutes', tlsroute: 'tlsroutes', tlsroutes: 'tlsroutes', tcproute: 'tcproutes', tcproutes: 'tcproutes',
    udproute: 'udproutes', udproutes: 'udproutes', grpcroute: 'grpcroutes', grpcroutes: 'grpcroutes',
    referencegrant: 'referencegrants', referencegrants: 'referencegrants', refgrant: 'referencegrants',
    crd: 'crds', crds: 'crds', customresourcedefinition: 'crds', customresourcedefinitions: 'crds',
    gw: 'istiogw',
  };
  const KIND_OF = { gateways: 'Gateway', httproutes: 'HTTPRoute', tlsroutes: 'TLSRoute', tcproutes: 'TCPRoute', udproutes: 'UDPRoute', grpcroutes: 'GRPCRoute', referencegrants: 'ReferenceGrant' };
  const kindFromRes = (k) => KIND_OF[k];
  const GW_RES = new Set(['gateways', 'gatewayclasses', 'httproutes', 'tlsroutes', 'tcproutes', 'udproutes', 'grpcroutes', 'referencegrants']);

  function metaOf(rec, apiVersion, kind, ns) {
    const md = { creationTimestamp: iso(rec.created), generation: rec.gen || 1, name: rec.name, resourceVersion: rvOf(rec), uid: uidOf(kind + (rec.ns || '') + rec.name) };
    if (rec.labels && Object.keys(rec.labels).length) md.labels = rec.labels;
    if (ns) md.namespace = ns;
    return { apiVersion, kind, metadata: md };
  }
  function listenerStatus(gv, l) {
    const t = gv.since, gen = gv.g.gen;
    const refBad = l.refErr;
    const conds = [
      cond('Accepted', 'True', 'Accepted', 'No errors found', gen, t),
      l.conflict ? cond('Conflicted', 'True', l.conflict, l.conflictMsg, gen, t) : cond('Conflicted', 'False', 'NoConflicts', 'No errors found', gen, t),
      (refBad || l.broken) ? cond('Programmed', 'False', 'Invalid', refBad && refBad.reason === 'InvalidCertificateRef' ? 'Bad TLS configuration' : 'Listener is not valid', gen, t) : cond('Programmed', 'True', 'Programmed', 'No errors found', gen, t),
      refBad ? cond('ResolvedRefs', 'False', refBad.reason, refBad.message, gen, t) : cond('ResolvedRefs', 'True', 'ResolvedRefs', 'No errors found', gen, t),
    ];
    return { attachedRoutes: l.attached.length, conditions: conds, name: l.name, supportedKinds: l.kinds.map((k) => ({ group: GROUP, kind: k })) };
  }
  function gatewayObj(gv) {
    const g = gv.g;
    const o = metaOf(g, `${GROUP}/v1`, 'Gateway', g.ns);
    o.spec = g.spec;
    if (gv.programmed) {
      const svcs = [...new Set(gv.listeners.map((l) => `${gv.svcName}.${g.ns}.svc.cluster.local:${l.port}`))].join(', ');
      o.status = {
        addresses: [{ type: 'IPAddress', value: g.ip }],
        conditions: [cond('Accepted', 'True', 'Accepted', 'Resource accepted', g.gen, gv.since), cond('Programmed', 'True', 'Programmed', `Resource programmed, assigned to service(s) ${svcs}`, g.gen, gv.since)],
        listeners: gv.listeners.map((l) => listenerStatus(gv, l)),
      };
      o.status.conditions[0].message = 'Deployed gateway to the cluster';
    }
    return o;
  }
  function routeObj(rv) {
    const r = rv.r;
    const o = metaOf(r, r.apiVersion || `${GROUP}/${ROUTE_VER[r.kind]}`, r.kind, r.ns);
    o.spec = r.spec;
    if (rv.hasStatus) {
      o.status = {
        parents: rv.parents.map((p) => ({
          conditions: [cond('Accepted', p.accepted ? 'True' : 'False', p.reason, p.message, r.gen, rv.since), cond('ResolvedRefs', rv.resolved.ok ? 'True' : 'False', rv.resolved.reason, rv.resolved.message, r.gen, rv.since)],
          controllerName: CONTROLLER, parentRef: p.parentRef,
        })),
      };
    }
    return o;
  }
  function grantObj(g) { const o = metaOf(g, g.apiVersion || `${GROUP}/v1beta1`, 'ReferenceGrant', g.ns); o.spec = g.spec; return o; }
  function classObj(cv) {
    const t = cv.classCreated;
    return { apiVersion: `${GROUP}/v1`, kind: 'GatewayClass', metadata: { creationTimestamp: iso(t), generation: 1, name: 'istio', resourceVersion: String(10000 + (hash('istio') % 5000)), uid: uidOf('GatewayClass istio') }, spec: { controllerName: CONTROLLER, description: 'The default Istio GatewayClass' }, status: { conditions: [cond('Accepted', 'True', 'Accepted', 'Handled by Istio controller', 1, t + 2000)] } };
  }
  function podObj(p) {
    const st = podState(p);
    const o = metaOf(p, 'v1', 'Pod', p.ns);
    o.spec = { containers: p.containers.map((c, i) => ({ name: c, image: (p.imgs && p.imgs[i]) || (p.kind === 'kiada' ? (i === 0 ? `luksa/kiada:${p.version}` : 'envoyproxy/envoy:v1.14.1') : p.kind === 'envoy' ? 'docker.io/istio/proxyv2:' + ISTIO_VERSION : p.kind === 'istiod' ? 'docker.io/istio/pilot:' + ISTIO_VERSION : 'busybox') })), nodeName: p.node };
    o.status = { hostIP: NODE_IPS[p.node] || '172.18.0.3', phase: st.isReady || st.status === 'Running' ? 'Running' : 'Pending', podIP: p.ip, podIPs: [{ ip: p.ip }] };
    return o;
  }
  function serviceObj(s) {
    const o = metaOf(s, 'v1', 'Service', s.ns);
    o.spec = { clusterIP: s.clusterIP, clusterIPs: [s.clusterIP], ports: s.ports.map((p) => { const q = { port: p.port, protocol: p.protocol || 'TCP', targetPort: p.targetPort }; if (p.name) q.name = p.name; if (p.nodePort) q.nodePort = p.nodePort; return q; }), type: s.type || 'ClusterIP' };
    if (Object.keys(s.selector || {}).length) o.spec.selector = s.selector;
    if (s.externalIP) o.status = { loadBalancer: { ingress: [{ ip: s.externalIP }] } };
    return o;
  }

  function endpointStr(svc, cv) {
    const eps = endpointsOf(svc, allPods(cv));
    if (svc.name === 'kubernetes' && svc.ns === 'default') return '172.18.0.2:6443';
    if (!eps.length) return '<none>';
    const list = [];
    for (const p of svc.ports) for (const e of eps) list.push(`${e.ip}:${p.targetPort}`);
    return list.length > 3 ? list.slice(0, 3).join(',') + ` + ${list.length - 3} more...` : list.join(',');
  }

  // each registry entry: ns?:bool, ok():bool, list(ns, cv):recs, name(rec), ns(rec), headers(wide,all), row(rec, wide, cv), obj(rec, cv), apiName
  function registry(cv) {
    const crdAge = () => age(S.crds || now());
    return {
      pods: { ns: true, list: (ns) => allPods(cv).filter((p) => ns === '*' || p.ns === ns), headers: (w) => ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'].concat(w ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : []), row: (p, w) => { const st = podState(p); return [p.name, `${st.ready}/${st.total}`, st.status, '0', age(p.created)].concat(w ? [p.ip, p.node, '<none>', '<none>'] : []); }, obj: podObj, apiName: 'pods', short: 'pod' },
      services: { ns: true, list: (ns) => { const l = allServices(cv).filter((s) => ns === '*' ? true : s.ns === ns); if (ns === NS && !l.some((s) => s.name === 'kubernetes')) l.push({ ...cv.derived.services.find((s) => s.name === 'kubernetes'), ns: NS, shadow: true }); return l.sort((a, b) => a.name.localeCompare(b.name)); }, headers: (w) => ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'].concat(w ? ['SELECTOR'] : []), row: (s, w) => [s.name, s.type || 'ClusterIP', s.clusterIP, s.externalIP || '<none>', svcPortStr(s), age(s.created)].concat(w ? [labelStr(s.selector) || '<none>'] : []), obj: serviceObj, apiName: 'services', short: 'service' },
      endpoints: { ns: true, list: (ns) => allServices(cv).filter((s) => (ns === '*' || s.ns === ns) && !s.shadow).sort((a, b) => a.name.localeCompare(b.name)), headers: () => ['NAME', 'ENDPOINTS', 'AGE'], row: (s) => [s.name, endpointStr(s, cv), age(s.created)], obj: (s) => { const eps = endpointsOf(s, allPods(cv)); const o = metaOf(s, 'v1', 'Endpoints', s.ns); o.subsets = eps.length ? [{ addresses: eps.map((e) => ({ ip: e.ip, nodeName: e.node, targetRef: { kind: 'Pod', name: e.name, namespace: e.ns } })), ports: s.ports.map((p) => ({ name: p.name, port: p.targetPort, protocol: p.protocol || 'TCP' })) }] : undefined; return o; }, apiName: 'endpoints', short: 'endpoints' },
      endpointslices: { ns: true, list: (ns) => allServices(cv).filter((s) => (ns === '*' || s.ns === ns) && !s.shadow).sort((a, b) => a.name.localeCompare(b.name)), headers: () => ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'], row: (s) => [s.name + '-' + hash(s.name).toString(36).slice(0, 5), 'IPv4', [...new Set(s.ports.map((p) => p.targetPort))].join(',') || '<unset>', endpointsOf(s, allPods(cv)).map((e) => e.ip).join(',') || '<unset>', age(s.created)], obj: (s) => ({ ...metaOf({ ...s, name: s.name + '-' + hash(s.name).toString(36).slice(0, 5) }, 'discovery.k8s.io/v1', 'EndpointSlice', s.ns), addressType: 'IPv4', endpoints: endpointsOf(s, allPods(cv)).map((e) => ({ addresses: [e.ip], conditions: { ready: true }, nodeName: e.node })), ports: s.ports.map((p) => ({ name: p.name, port: p.targetPort, protocol: p.protocol || 'TCP' })) }), apiName: 'endpointslices.discovery.k8s.io', short: 'endpointslice' },
      secrets: { ns: true, list: (ns) => Object.values(S.secrets).filter((s) => ns === '*' || s.ns === ns), headers: () => ['NAME', 'TYPE', 'DATA', 'AGE'], row: (s) => [s.name, s.type, '2', age(s.created)], obj: (s) => ({ ...metaOf(s, 'v1', 'Secret', s.ns), data: { 'tls.crt': 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...', 'tls.key': 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t...' }, type: s.type }), apiName: 'secrets', short: 'secret' },
      namespaces: { ns: false, list: () => Object.entries(S.namespaces).map(([name, v]) => ({ name, ns: '', labels: Object.assign({ 'kubernetes.io/metadata.name': name }, v.labels), created: v.created })).concat(S.istio ? [{ name: 'istio-system', ns: '', labels: { 'kubernetes.io/metadata.name': 'istio-system' }, created: S.istio.at }] : []).sort((a, b) => a.name.localeCompare(b.name)), headers: (w, a, showLabels) => ['NAME', 'STATUS', 'AGE'].concat(showLabels ? ['LABELS'] : []), row: (n, w, showLabels) => [n.name, 'Active', age(n.created)].concat(showLabels ? [labelStr(n.labels)] : []), obj: (n) => ({ ...metaOf(n, 'v1', 'Namespace'), spec: { finalizers: ['kubernetes'] }, status: { phase: 'Active' } }), apiName: 'namespaces', short: 'namespace' },
      nodes: { ns: false, list: () => [['kind-control-plane', 'control-plane'], ['kind-worker', '<none>'], ['kind-worker2', '<none>']].map(([name, roles]) => ({ name, ns: '', roles, created: S.namespaces.default.created })), headers: () => ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'], row: (n) => [n.name, 'Ready', n.roles, age(n.created), 'v1.31.0'], obj: (n) => ({ ...metaOf(n, 'v1', 'Node'), status: { nodeInfo: { kubeletVersion: 'v1.31.0' } } }), apiName: 'nodes', short: 'node' },
      gateways: { ns: true, need: 'crd', list: (ns) => cv.gwList.filter((gv) => ns === '*' || gv.g.ns === ns), name: (gv) => gv.g.name, nsOf: (gv) => gv.g.ns, created: (gv) => gv.g.created, headers: () => ['NAME', 'CLASS', 'ADDRESS', 'PROGRAMMED', 'AGE'], row: (gv) => [gv.g.name, gv.g.spec.gatewayClassName, gv.programmed ? gv.g.ip : '', gv.programmed ? 'True' : 'Unknown', age(gv.g.created)], obj: gatewayObj, apiName: 'gateways.' + GROUP, short: 'gateway', labels: (gv) => gv.g.labels },
      gatewayclasses: { ns: false, need: 'crd', list: () => (cv.classReady ? [{ name: 'istio', ns: '', created: cv.classCreated, cls: true }] : []), headers: (w) => ['NAME', 'CONTROLLER', 'ACCEPTED', 'AGE'].concat(w ? ['DESCRIPTION'] : []), row: (c, w) => ['istio', CONTROLLER, 'True', age(c.created)].concat(w ? ['The default Istio GatewayClass'] : []), obj: () => classObj(cv), apiName: 'gatewayclasses.' + GROUP, short: 'gatewayclass' },
      referencegrants: { ns: true, need: 'crd', list: (ns) => Object.values(S.grants).filter((g) => ns === '*' || g.ns === ns).sort((a, b) => a.created - b.created), headers: () => ['NAME', 'AGE'], row: (g) => [g.name, age(g.created)], obj: grantObj, apiName: 'referencegrants.' + GROUP, short: 'referencegrant', labels: (g) => g.labels },
      crds: { ns: false, list: () => (S.crds ? CRD_NAMES.map((n) => ({ name: n, ns: '', created: S.crds })) : []), headers: () => ['NAME', 'CREATED AT'], row: (c) => [c.name, iso(c.created)], obj: (c) => ({ apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', metadata: { creationTimestamp: iso(c.created), name: c.name }, spec: { group: GROUP, names: { kind: Object.values(KIND_OF).concat(['GatewayClass'])[CRD_NAMES.indexOf(c.name)] || '', plural: c.name.split('.')[0] }, scope: c.name.startsWith('gatewayclasses') ? 'Cluster' : 'Namespaced' } }), apiName: 'customresourcedefinitions.apiextensions.k8s.io', short: 'customresourcedefinition' },
      istiogw: { ns: true, list: () => [], headers: () => ['NAME', 'AGE'], row: () => [], obj: () => ({}), apiName: 'gateways.networking.istio.io', short: 'gateway' },
    };
  }
  function routeReg(cv, plural) {
    const kind = KIND_OF[plural];
    const hasHosts = kind === 'HTTPRoute' || kind === 'TLSRoute' || kind === 'GRPCRoute';
    return { ns: true, need: 'crd', list: (ns) => cv.routeList.filter((rv) => rv.r.kind === kind && (ns === '*' || rv.r.ns === ns)), name: (rv) => rv.r.name, nsOf: (rv) => rv.r.ns, created: (rv) => rv.r.created, headers: () => hasHosts ? ['NAME', 'HOSTNAMES', 'AGE'] : ['NAME', 'AGE'], row: (rv) => hasHosts ? [rv.r.name, rv.r.spec.hostnames && rv.r.spec.hostnames.length ? JSON.stringify(rv.r.spec.hostnames) : '<none>', age(rv.r.created)] : [rv.r.name, age(rv.r.created)], obj: routeObj, apiName: plural + '.' + GROUP, short: kind.toLowerCase(), labels: (rv) => rv.r.labels };
  }
  function regFor(res, cv) {
    if (KIND_OF[res] && res !== 'gateways' && res !== 'referencegrants') return routeReg(cv, res);
    return registry(cv)[res];
  }
  const recName = (def, rec) => (def.name ? def.name(rec) : rec.name);
  const recNs = (def, rec) => (def.nsOf ? def.nsOf(rec) : rec.ns);

  function getRes(res, names, f, ctx, opts = {}) {
    const cv = clusterView();
    const def = regFor(res, cv);
    const asked = f.ns || S.curNs;
    const ns = f.all ? '*' : asked;
    if (GW_RES.has(res) && !crdsInstalled()) { ctx.err(`error: the server doesn't have a resource type "${opts.alias || res}"`); ctx.hint('The Gateway API CRDs are not installed in this cluster (section 13.1.3).'); return; }
    if (res === 'istiogw' && !S.istio) { ctx.err(`error: the server doesn't have a resource type "gw"`); ctx.hint('gw is Istio own Gateway kind (networking.istio.io); it only exists once Istio is installed. The Gateway API one is gtw.'); return; }
    if (res === 'istiogw') { ctx.out(f.all ? 'No resources found' : `No resources found in ${asked} namespace.`); ctx.hint('gw is Istio\'s own Gateway kind (networking.istio.io). The Gateway API one is gtw (gateway.networking.k8s.io).'); return; }
    let recs = def.list(ns).slice().sort((a, b) => (recNs(def, a) + '/' + recName(def, a)).localeCompare(recNs(def, b) + '/' + recName(def, b)));
    if (f.sel) { const test = parseSelector(f.sel); recs = recs.filter((r) => test((def.labels ? def.labels(r) : r.labels) || {})); }
    if (names.length) {
      const found = [];
      for (const n of names) { const r = recs.find((x) => recName(def, x) === n); if (r) found.push(r); else { opts.missing = (opts.missing || []).concat(n); } }
      recs = found;
    }
    const notFound = () => { for (const n of opts.missing || []) ctx.err(`Error from server (NotFound): ${def.apiName === 'pods' ? 'pods' : def.apiName} "${n}" not found`); };
    const out = f.out || '';
    if (out === 'yaml' || out === 'json' || out.startsWith('jsonpath') || out === 'name') {
      if (!recs.length) { if ((opts.missing || []).length) notFound(); else ctx.out(ns === '*' ? 'No resources found' : `No resources found in ${asked} namespace.`); return; }
      const objs = recs.map((r) => sortDeep(def.obj(r, cv)));
      if (out === 'name') { ctx.out(recs.map((r) => `${def.short}${def.short === 'gateway' || ROUTE_KINDS.map((k) => k.toLowerCase()).includes(def.short) || def.short === 'referencegrant' ? '.' + GROUP : ''}/${recName(def, r)}`).join('\n')); notFound(); return; }
      if (out.startsWith('jsonpath=')) { const expr = out.slice(9).replace(/^['"]|['"]$/g, ''); const root = names.length === 1 && objs.length === 1 ? objs[0] : { items: objs }; ctx.out(jsonPath(root, expr)); notFound(); return; }
      const single = names.length === 1 || (objs.length === 1 && names.length);
      if (out === 'json') { ctx.out(single ? JSON.stringify(objs[0], null, 2) : JSON.stringify({ apiVersion: 'v1', items: objs, kind: 'List', metadata: { resourceVersion: '' } }, null, 2)); notFound(); return; }
      if (single && objs.length === 1) ctx.out(toYaml(objs[0]), 'yaml');
      else ctx.out(toYaml({ apiVersion: 'v1', items: objs, kind: 'List', metadata: { resourceVersion: '' } }), 'yaml');
      notFound();
      return;
    }
    if (!recs.length) { if (!(opts.missing || []).length) ctx.out(ns === '*' || !def.ns ? 'No resources found' : `No resources found in ${asked} namespace.`); notFound(); return; }
    const wide = out === 'wide';
    const showLabels = !!f.showLabels;
    const rows = recs.map((r) => { const row = def.row(r, wide || showLabels, showLabels); return ns === '*' && def.ns ? [recNs(def, r), ...row] : row; });
    const hd = def.headers(wide, ns === '*', showLabels);
    ctx.out(table(ns === '*' && def.ns ? ['NAMESPACE', ...hd] : hd, rows));
    notFound();
    // teaching hints
    if (res === 'gateways' && recs.some((gv) => !gv.programmed)) {
      if (!controllerInstalled()) ctx.hint('ADDRESS is empty and PROGRAMMED is Unknown: no Gateway controller is running, so nothing acts on this Gateway. Install Istio (section 13.1.3).');
      else if (!controllerReady()) ctx.hint('istiod is still starting, so the Gateway is not programmed yet. Check: kubectl get pods -n istio-system');
      else if (recs.some((gv) => gv.managed)) ctx.hint('The controller is still reconciling this Gateway. Run the command again in a second.');
      else ctx.hint('No controller claims this Gateway\'s gatewayClassName. Check kubectl get gatewayclasses.');
    }
    if (res === 'pods' && ns === 'istio-system' && recs.some((p) => !podState(p).isReady)) ctx.hint('istiod READY is 0/1: still starting. Run it again in a few seconds.');
    if (res === 'httproutes' && recs.length && !cv.active) ctx.hint('No controller is handling this route (no status yet): Gateway API objects are just data until Istio is running.');
  }

  // ---------- describe ----------
  const TITLES = { apiVersion: 'API Version', uid: 'UID', controllerName: 'Controller Name', parentRef: 'Parent Ref', clusterIP: 'IP', clusterIPs: 'IPs', podIP: 'IP', podIPs: 'IPs', hostIP: 'Host IP', ip: 'IP' };
  const RAW_KEYS = new Set(['selector', 'matchLabels', 'labels', 'annotations']);
  const titleOf = (k) => TITLES[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  function renderTree(o, ind, raw) {
    const pad = ' '.repeat(ind), L = [];
    const isO = (x) => x && typeof x === 'object' && !Array.isArray(x);
    const T = (k) => (raw ? k : titleOf(k));
    if (Array.isArray(o)) {
      for (const it of o) { if (isO(it)) L.push(...renderTree(it, ind, raw)); else L.push(pad + String(it)); }
      return L;
    }
    const scalars = Object.entries(o).filter(([, v]) => !isO(v) && !Array.isArray(v));
    const w = Math.max(0, ...scalars.map(([k]) => T(k).length)) + 1;
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v) && v.length && !v.some(isO)) { L.push(pad + T(k) + ':'); for (const x of v) L.push(pad + '  ' + x); }
      else if (Array.isArray(v) && !v.length) L.push(pad + (T(k) + ':').padEnd(w + 2) + '[]');
      else if (Array.isArray(v) || (isO(v) && Object.keys(v).length)) { L.push(pad + T(k) + ':'); L.push(...renderTree(v, ind + 2, raw || RAW_KEYS.has(k))); }
      else if (isO(v)) L.push(pad + (T(k) + ':').padEnd(w + 2) + '<empty>');
      else L.push(pad + (T(k) + ':').padEnd(w + 2) + v);
    }
    return L;
  }
  function describeObj(obj, extraEvents) {
    const md = obj.metadata;
    const hd = [['Name:', md.name], ['Namespace:', md.namespace || ''], ['Labels:', md.labels ? labelStr(md.labels) : '<none>'], ['Annotations:', '<none>'], ['API Version:', obj.apiVersion], ['Kind:', obj.kind]].filter(([k, v]) => !(k === 'Namespace:' && !v));
    const L = hd.map(([k, v]) => k.padEnd(14) + v);
    const rest = { ...md }; delete rest.name; delete rest.namespace; delete rest.labels;
    L.push('Metadata:'); L.push(...renderTree(rest, 2));
    if (obj.spec) { L.push('Spec:'); L.push(...renderTree(obj.spec, 2)); }
    if (obj.status) { L.push('Status:'); L.push(...renderTree(obj.status, 2)); }
    L.push('Events:' + (extraEvents ? '\n' + extraEvents : '  <none>'));
    return L.join('\n');
  }

  // ---------- explain ----------
  const EXPLAIN = {
    gateway: `GROUP:      gateway.networking.k8s.io
KIND:       Gateway
VERSION:    v1

DESCRIPTION:
    Gateway represents an instance of a service-traffic handling infrastructure
    by binding Listeners to a set of IP addresses.

FIELDS:
  apiVersion	<string>
  kind	<string>
  metadata	<ObjectMeta>
  spec	<GatewaySpec> -required-
    Spec defines the desired state of Gateway.
  status	<GatewayStatus>
    Status defines the current state of Gateway.`,
    'gateway.spec': `GROUP:      gateway.networking.k8s.io
KIND:       Gateway
VERSION:    v1

FIELD: spec <GatewaySpec>

DESCRIPTION:
    Spec defines the desired state of Gateway.
    GatewaySpec defines the desired state of Gateway.

    Not all possible combinations of options specified in the Spec are
    valid. Some invalid configurations can be caught synchronously via CRD
    validation, but there are many cases that will require asynchronous
    signaling via the Gateway's status conditions.

FIELDS:
  addresses	<[]GatewayAddress>
    Addresses requested for this Gateway. This is optional and behavior can
    depend on the implementation. If a value is set in the spec and the
    requested address is invalid or unavailable, the implementation MUST
    indicate this in the associated entry in GatewayStatus.Addresses.

  gatewayClassName	<string> -required-
    GatewayClassName used for this Gateway. This is the name of a
    GatewayClass resource.

  listeners	<[]Listener> -required-
    Listeners associated with this Gateway. Listeners define logical
    endpoints that are bound on this Gateway's addresses. At least one
    Listener MUST be specified.`,
    httproute: `GROUP:      gateway.networking.k8s.io
KIND:       HTTPRoute
VERSION:    v1

DESCRIPTION:
    HTTPRoute provides a way to route HTTP requests. This includes the
    capability to match requests by hostname, path, header, or query param.
    Filters can be used to specify additional processing steps. Backends
    specify where matching requests should be routed.

FIELDS:
  apiVersion	<string>
  kind	<string>
  metadata	<ObjectMeta>
  spec	<HTTPRouteSpec>
  status	<HTTPRouteStatus>`,
    'httproute.spec': `GROUP:      gateway.networking.k8s.io
KIND:       HTTPRoute
VERSION:    v1

FIELD: spec <HTTPRouteSpec>

DESCRIPTION:
    Spec defines the desired state of HTTPRoute.

FIELDS:
  hostnames	<[]string>
    Hostnames defines a set of hostnames that should match against the HTTP
    Host header to select a HTTPRoute used to process the request.

  parentRefs	<[]ParentReference>
    ParentRefs references the resources (usually Gateways) that a Route wants
    to be attached to.

  rules	<[]HTTPRouteRule>
    Rules are a list of HTTP matchers, filters and actions.`,
    'httproute.spec.rules': `GROUP:      gateway.networking.k8s.io
KIND:       HTTPRoute
VERSION:    v1

FIELD: rules <[]HTTPRouteRule>

DESCRIPTION:
    Rules are a list of HTTP matchers, filters and actions.
    HTTPRouteRule defines semantics for matching an HTTP request based on
    conditions (matches), processing it (filters), and forwarding the request
    to an API object (backendRefs).

FIELDS:
  backendRefs	<[]HTTPBackendRef>
    BackendRefs defines the backend(s) where matching requests should be sent.
    Failure behavior here depends on how many BackendRefs are specified: if
    a backend cannot be resolved, requests that would have gone there get a
    500 status code.

  filters	<[]HTTPRouteFilter>
    Filters define the filters that are applied to requests that match this
    rule. Supported types: RequestHeaderModifier, ResponseHeaderModifier,
    RequestMirror, RequestRedirect, URLRewrite, ExtensionRef.

  matches	<[]HTTPRouteMatch>
    Matches define conditions used for matching the rule against incoming
    HTTP requests. Each match is independent, i.e. this rule will be matched
    if any single match is satisfied. If no matches are specified, the
    implementation MUST match every HTTP request (a PathPrefix match on "/").

  timeouts	<HTTPRouteTimeouts>
    Timeouts defines the timeouts that can be configured for an HTTP request.`,
  };

  // ---------- kubectl ----------
  const KUBECTL_FLAGS = {
    val: { '-n': 'ns', '--namespace': 'ns', '-o': 'out', '--output': 'out', '-f': 'file', '--filename': 'file', '-k': 'kustomize', '--kustomize': 'kustomize', '--selector': 'sel', '-l': 'sel', '-c': 'container', '--container': 'container', '--for': 'for', '--timeout': 'timeout', '--tail': 'tail', '--context': 'context', '--since': 'since' },
    bool: { '-A': 'all', '--all-namespaces': 'all', '-R': 'rec', '--recursive': 'rec', '-w': 'watch', '--watch': 'watch', '--show-labels': 'showLabels', '--overwrite': 'overwrite', '--current': 'current', '--no-headers': 'noHeaders', '--previous': 'previous', '-p': 'previous' },
  };
  const SETUP_LINES = () => ['namespace/kiada unchanged', ...['kiada-001', 'kiada-002', 'kiada-003', 'quote-001', 'quote-002', 'quote-003', 'quiz'].map((p) => `pod/${p} unchanged`), 'secret/kiada-tls unchanged', 'service/kiada unchanged', 'service/quote unchanged', 'service/quiz unchanged'];
  const SETUP_FILE_LINE = (f) => { const m = f.match(/^(ns|pod|svc|secret)\.(.+)\.yaml$/); if (!m) return null; return `${{ ns: 'namespace', pod: 'pod', svc: 'service', secret: 'secret' }[m[1]]}/${m[2]} unchanged`; };

  async function kubectl(argv, ctx) {
    const verb = argv[0];
    let rest = argv.slice(1);
    if (verb === 'logs') rest = rest.filter((a) => a !== '-f' && a !== '--follow');
    const { pos, f } = flags(rest, KUBECTL_FLAGS);
    if (!verb) { ctx.out('kubectl controls the Kubernetes cluster manager.\n\nTry: kubectl get gtw'); return; }

    if (verb === 'get') {
      let [res, ...names] = pos;
      if (!res) { ctx.err('You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.'); return; }
      if (res.includes(',')) {
        for (const r of res.split(',')) { const k = RES[r.toLowerCase()]; if (!k) { ctx.err(`error: the server doesn't have a resource type "${r}"`); return; } getRes(k, names, f, ctx, { alias: r }); ctx.out(''); }
        return;
      }
      if (res.includes('/')) { const [r, n] = res.split('/'); res = r; names = [n, ...names]; }
      const kind = RES[res.toLowerCase().replace(/\.gateway\.networking\.k8s\.io$/, '')];
      if (!kind) { ctx.err(`error: the server doesn't have a resource type "${res}"`); return; }
      return getRes(kind, names, f, ctx, { alias: res });
    }
    if (verb === 'describe') {
      let [res, name] = pos;
      if (res && res.includes('/')) [res, name] = res.split('/');
      const kind = RES[(res || '').toLowerCase()];
      if (!kind) { ctx.err(`error: the server doesn't have a resource type "${res}"`); return; }
      if (!GW_RES.has(kind) && kind !== 'pods' && kind !== 'services') { ctx.out('(this simulator describes gateways, routes, referencegrants, pods and services: kubectl describe gtw <name>)', 'hint'); return; }
      if (GW_RES.has(kind) && !crdsInstalled()) { ctx.err(`error: the server doesn't have a resource type "${res}"`); return; }
      const cv = clusterView();
      const def = regFor(kind, cv);
      const ns = f.all ? '*' : (f.ns || S.curNs);
      let recs = def.list(ns);
      if (name) recs = recs.filter((r) => recName(def, r) === name);
      if (name && !recs.length) { ctx.err(`Error from server (NotFound): ${def.apiName} "${name}" not found`); return; }
      if (!recs.length) { ctx.out(`No resources found in ${ns} namespace.`); return; }
      ctx.out(recs.map((r) => {
        const obj = sortDeep(def.obj(r, cv));
        let ev;
        if (kind === 'gateways' && r.programmed) ev = `  Type    Reason  Age   From                          Message\n  ----    ------  ----  ----                          -------\n  Normal  Sync    ${age(r.since).padEnd(5)} istio.io/gateway-controller  Successfully synced`;
        return describeObj(obj, ev);
      }).join('\n\n\n'));
      return;
    }
    if (verb === 'apply' || (verb === 'create' && (f.file || f.kustomize))) {
      if (f.kustomize) {
        const k = f.kustomize.replace(/\/$/, '');
        if (/github\.com\/kubernetes-sigs\/gateway-api\/config\/crd(\/experimental)?$/.test(k) || /^https:\/\/github\.com\/kubernetes-sigs\/gateway-api\/config\/crd(\/experimental)?(\?.*)?$/.test(k)) {
          const already = crdsInstalled();
          for (const n of CRD_NAMES) { ctx.out(`customresourcedefinition/${n} ${already ? 'unchanged' : 'created'}`); if (!already) await ctx.sleep(60); }
          if (!already) {
            installCrds();
            if (!/experimental/.test(k)) ctx.hint('That is the standard channel only. This chapter needs the experimental one (TLSRoute, TCPRoute, UDPRoute, GRPCRoute): .../config/crd/experimental');
            ctx.hint('The CRDs only teach the API server the new kinds. Nothing acts on Gateways yet: you still need a controller (Istio).');
          }
          save();
          return;
        }
        ctx.err(`error: must build at directory: not a valid directory: evalsymlink failure on '${f.kustomize}' : lstat ${f.kustomize}: no such file or directory`);
        return;
      }
      const file = f.file;
      if (!file) { ctx.err('error: must specify one of -f and -k'); return; }
      if (/^https?:[/][/]/.test(file) || /^github[.]com[/]/.test(file)) {
        if (/gateway-api/.test(file)) { ctx.err(`error: error parsing ${file}: error converting YAML to JSON: yaml: line 1: did not find expected <document start>`); ctx.hint('That URL is a Kustomize directory, not a manifest file. Use -k instead of -f: kubectl apply -k github.com/kubernetes-sigs/gateway-api/config/crd/experimental'); return; }
        ctx.err(`error: unable to read URL "${file}", server reported 404 Not Found, status code=404`);
        return;
      }
      const clean = file.replace(/^\.\//, '').replace(/\/$/, '');
      if (clean === 'SETUP') { ctx.out(SETUP_LINES().join('\n')); return; }
      if (/^SETUP\//.test(clean)) { const l = SETUP_FILE_LINE(clean.slice(6)); if (l && DIRS.SETUP.includes(clean.slice(6))) { ctx.out(l); return; } ctx.err(`error: the path "${file}" does not exist`); return; }
      if (!FILES[clean]) { ctx.err(`error: the path "${file}" does not exist`); return; }
      const docs = YAML.parseAll(FILES[clean]);
      const errs = [];
      const created = [];
      for (const d of docs) {
        const r = applyDoc(d, clean, { ns: f.ns || S.curNs });
        if (r.err) errs.push(r); else { ctx.out(r.msg); if (/ created$/.test(r.msg)) created.push(d); }
      }
      for (const e of errs) { ctx.err(e.err); if (e.hint) ctx.hint(e.hint); }
      save();
      if (!errs.length) {
        if (created.some((d) => d.kind === 'Gateway') && !controllerActive()) ctx.hint(!controllerInstalled() ? 'The Gateway exists as data, but no controller is installed, so it will stay unprogrammed (ADDRESS empty). See section 13.1.3.' : 'istiod is not ready yet, so the Gateway is not programmed. It will be as soon as istiod is Ready.');
        const r1 = created.find((d) => ROUTE_KINDS.includes(d.kind));
        if (r1 && /^(UDPRoute|GRPCRoute)$/.test(r1.kind)) ctx.hint(`Check kubectl get ${r1.kind.toLowerCase()} ${r1.metadata.name} -o yaml: Istio (in the book's version) doesn't implement ${r1.kind}, so the object gets no status at all.`);
      }
      return;
    }
    if (verb === 'delete') {
      if (f.file) {
        const clean = f.file.replace(/^\.\//, '');
        if (!FILES[clean]) { ctx.err(`error: the path "${f.file}" does not exist`); return; }
        const docs = YAML.parseAll(FILES[clean]);
        for (const d of docs.slice().reverse().sort((a, b) => (a.kind === 'Namespace') - (b.kind === 'Namespace'))) {
          const r = deleteObj(d.kind, d.metadata.name, d.metadata.namespace || f.ns || S.curNs, clean);
          if (r.err) { ctx.err(r.err); if (r.hint) ctx.hint(r.hint); } else { ctx.out(r.msg); if (r.hint) ctx.hint(r.hint); }
        }
        save(); return;
      }
      let [res, ...names] = pos;
      if (res && res.includes('/')) { names = [res.split('/')[1], ...names]; res = res.split('/')[0]; }
      const rk = RES[(res || '').toLowerCase()];
      if (!rk) { ctx.err(res ? `error: the server doesn't have a resource type "${res}"` : 'error: You must provide one or more resources by argument or filename.'); return; }
      if (!names.length) { ctx.err('error: resource(s) were provided, but no name was specified'); return; }
      if (GW_RES.has(rk) && !crdsInstalled()) { ctx.err(`error: the server doesn't have a resource type "${res}"`); return; }
      const kind = { pods: 'Pod', services: 'Service', secrets: 'Secret', namespaces: 'Namespace' }[rk] || KIND_OF[rk];
      if (!kind) { ctx.err(`error: cannot delete ${res} in this simulator`); return; }
      for (const n of names) {
        const r = deleteObj(kind, n, f.ns || S.curNs);
        if (r.err) { ctx.err(r.err); if (r.hint) ctx.hint(r.hint); } else { ctx.out(r.msg); if (r.hint) ctx.hint(r.hint); }
      }
      save(); return;
    }
    if (verb === 'create') {
      if (pos[0] === 'ns' || pos[0] === 'namespace') {
        const name = pos[1];
        if (!name) { ctx.err('error: exactly one NAME is required, got 0'); return; }
        if (S.namespaces[name] || (name === 'istio-system' && S.istio)) { ctx.err(`Error from server (AlreadyExists): namespaces "${name}" already exists`); return; }
        S.namespaces[name] = { labels: {}, created: now() };
        save();
        ctx.out(`namespace/${name} created`);
        return;
      }
      ctx.out('(this simulator supports: kubectl create ns <name>, and kubectl create -f <file>)', 'hint');
      return;
    }
    if (verb === 'label') {
      const [res, name, ...kvs] = pos;
      const rk = RES[(res || '').toLowerCase()];
      if (rk !== 'namespaces' && rk !== 'pods') { ctx.out('(this simulator labels namespaces and pods: kubectl label ns kiada part-of=kiada)', 'hint'); return; }
      if (!name || !kvs.length) { ctx.err('error: at least one label update is required'); return; }
      let target, lname;
      if (rk === 'namespaces') { target = S.namespaces[name]; lname = `namespace/${name}`; if (!target) { ctx.err(`Error from server (NotFound): namespaces "${name}" not found`); return; } }
      else { target = S.pods[(f.ns || S.curNs) + '/' + name]; lname = `pod/${name}`; if (!target) { ctx.err(`Error from server (NotFound): pods "${name}" not found`); return; } }
      let changed = false;
      for (const kv of kvs) {
        if (kv.endsWith('-')) { const k = kv.slice(0, -1); if (target.labels[k] !== undefined) { delete target.labels[k]; changed = true; } continue; }
        const i = kv.indexOf('=');
        if (i < 0) { ctx.err(`error: invalid label spec: ${kv}`); return; }
        const k = kv.slice(0, i), v = kv.slice(i + 1);
        if (target.labels[k] !== undefined && target.labels[k] !== v && !f.overwrite) { ctx.err(`error: '${k}' already has a value (${target.labels[k]}), and --overwrite is false`); return; }
        if (target.labels[k] !== v) { target.labels[k] = v; changed = true; }
      }
      save();
      ctx.out(`${lname} ${changed ? 'labeled' : 'not labeled'}`);
      return;
    }
    if (verb === 'explain') {
      const what = (pos[0] || '').toLowerCase().replace(/^gtw/, 'gateway').replace(/^gateways/, 'gateway').replace(/^httproutes/, 'httproute');
      if (EXPLAIN[what]) { ctx.out(EXPLAIN[what]); return; }
      ctx.out('(try: kubectl explain gateway.spec  or  kubectl explain httproute.spec.rules)', 'hint');
      return;
    }
    if (verb === 'logs') return kubectlLogs(pos, f, ctx);
    if (verb === 'wait') {
      const target = pos.join(' ');
      const want = (f.for || '').toLowerCase();
      const tmo = Math.min(30000, (parseInt(f.timeout, 10) || 30) * 1000);
      const t0 = now();
      const check = () => {
        const cv = clusterView();
        if (/pod|istiod|^-l|app=istiod/.test(target) || /ready/.test(want)) { const ps = allPods(cv).filter((p) => (f.ns || S.curNs) === p.ns && (!f.sel || parseSelector(f.sel)(p.labels)) && (!pos[1] || pos[1].replace(/^pods?\//, '') === p.name || /^pods?$/.test(pos[0] || ''))); return { ok: ps.length > 0 && ps.every((p) => podState(p).isReady), names: ps.map((p) => `pod/${p.name}`) }; }
        const gv = cv.gwList.find((g) => target.includes(g.g.name));
        return { ok: !!gv && gv.programmed, names: gv ? [`gateway.${GROUP}/${gv.g.name}`] : [] };
      };
      for (;;) {
        const r = check();
        if (r.ok) { r.names.forEach((n) => ctx.out(`${n} condition met`)); return; }
        if (!r.names.length && now() - t0 > 1500) { ctx.err('error: no matching resources found'); return; }
        if (now() - t0 > tmo) { ctx.err('error: timed out waiting for the condition on ' + (r.names[0] || target)); return; }
        await ctx.sleep(500);
      }
    }
    if (verb === 'config') {
      if (pos[0] === 'set-context') { if (f.ns) { S.curNs = f.ns; save(); } ctx.out('Context "kind-kind" modified.'); return; }
      if (pos[0] === 'current-context') { ctx.out('kind-kind'); return; }
      if (pos[0] === 'get-contexts') { ctx.out(table(['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'], [['*', 'kind-kind', 'kind-kind', 'kind-kind', S.curNs]])); return; }
      ctx.out('(this simulator supports: kubectl config set-context --current --namespace <ns>)', 'hint');
      return;
    }
    if (verb === 'edit') { ctx.out('(no editor in this simulator: edit the file and use kubectl apply -f instead)', 'hint'); return; }
    if (verb === 'version') { ctx.out('Client Version: v1.31.2\nKustomize Version: v5.4.2\nServer Version: v1.31.0'); return; }
    if (verb === 'cluster-info') { ctx.out('Kubernetes control plane is running at https://127.0.0.1:41237\nCoreDNS is running at https://127.0.0.1:41237/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy'); return; }
    if (verb === 'api-resources') { ctx.out(table(['NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND'], crdsInstalled() ? [['gatewayclasses', 'gc', GROUP + '/v1', 'false', 'GatewayClass'], ['gateways', 'gtw', GROUP + '/v1', 'true', 'Gateway'], ['grpcroutes', '', GROUP + '/v1alpha2', 'true', 'GRPCRoute'], ['httproutes', '', GROUP + '/v1', 'true', 'HTTPRoute'], ['referencegrants', 'refgrant', GROUP + '/v1beta1', 'true', 'ReferenceGrant'], ['tcproutes', '', GROUP + '/v1alpha2', 'true', 'TCPRoute'], ['tlsroutes', '', GROUP + '/v1alpha2', 'true', 'TLSRoute'], ['udproutes', '', GROUP + '/v1alpha2', 'true', 'UDPRoute']] : [['pods', 'po', 'v1', 'true', 'Pod'], ['services', 'svc', 'v1', 'true', 'Service']])); return; }
    ctx.err(`error: unknown command "${verb}" for "kubectl"`);
  }

  function kubectlLogs(pos, f, ctx) {
    const cv = clusterView();
    let target = pos[0] || '';
    if (!target) { ctx.err('error: expected \'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]\'.\nPOD or TYPE/NAME is a required argument for the logs command'); return; }
    const ns = f.ns || S.curNs;
    let pod;
    const isDeploy = target.startsWith('deploy');
    target = target.replace(/^(?:pods?|deploy(?:ments?)?)[/]/, '');
    pod = allPods(cv).find((p) => p.ns === ns && p.name === target);
    if (!pod && isDeploy) pod = allPods(cv).find((p) => p.ns === ns && p.name.startsWith(target + '-'));
    if (!pod) { ctx.err(`Error from server (NotFound): pods "${target}" not found`); if (ns !== 'istio-system' && /istiod/.test(target)) ctx.hint('istiod lives in the istio-system namespace: add -n istio-system'); return; }
    const st = podState(pod);
    let cont = f.container;
    if (!cont) {
      if (pod.containers.length > 1) {
        if (pod.kind === 'kiada') { ctx.out(`Defaulted container "kiada" out of: ${pod.containers.join(', ')}`, 'dim'); cont = 'kiada'; }
        else { ctx.err(`error: a container name must be specified for pod ${pod.name}, choose one of: [${pod.containers.join(' ')}]`); return; }
      } else cont = pod.containers[0];
    }
    if (!pod.containers.includes(cont)) { ctx.err(`Error from server (BadRequest): container ${cont} is not valid for pod ${pod.name}`); return; }
    if (st.status === 'ContainerCreating') { ctx.err(`Error from server (BadRequest): container "${cont}" in pod "${pod.name}" is waiting to start: ContainerCreating`); return; }
    const lines = [];
    const iso0 = (t) => new Date(t).toISOString();
    if (pod.kind === 'kiada' && cont === 'kiada') {
      lines.push('Kiada - Kubernetes in Action Demo Application', `Kiada ${pod.version} starting...`, `Local hostname is ${pod.name}`, 'Listening on port 8080');
      for (const e of S.plog[pod.ns + '/' + pod.name] || []) { lines.push(e.line); if (e.note) lines.push(e.note); }
    } else if (pod.kind === 'kiada') {
      lines.push(`[${iso0(pod.created + 1500)}][1][info][main] [source/server/server.cc:810] starting main dispatch loop`, `[${iso0(pod.created + 1700)}][1][info][config] [source/server/listener_manager_impl.cc:830] all dependencies initialized. starting workers`);
    } else if (pod.kind === 'envoy') {
      lines.push(`${iso0(pod.created + 900)}\tinfo\tEnvoy proxy is ready`, `${iso0(pod.created + 800)}\tinfo\txdsproxy\tconnected to delta upstream XDS server: istiod.istio-system.svc:15012`);
      lines.push(...(S.glog[pod.gwKey] || []));
    } else if (pod.istiod) {
      lines.push(`${iso0(pod.created + 1200)}\tinfo\tFLAG: --domain="cluster.local"`, `${iso0(pod.created + 2600)}\tinfo\tkube\tGateway API CRDs found; starting the Gateway controller`, `${iso0(pod.created + 4200)}\tinfo\tgateway\tstarting Gateway controller`, `${iso0(pod.created + 4300)}\tinfo\tgateway\tGatewayClass "istio" accepted`);
      if (st.isReady) lines.push(`${iso0(pod.created + ISTIO_READY_MS)}\tinfo\tReady`);
      for (const gv of cv.gwList) if (gv.programmed) lines.push(`${iso0(gv.since)}\tinfo\tgateway\treconciled Gateway ${gv.g.ns}/${gv.g.name}`);
    } else if (pod.kind === 'quote' || pod.kind === 'quiz') {
      lines.push(`${iso0(pod.created)} ${cont} started`);
      for (const e of S.plog[pod.ns + '/' + pod.name] || []) lines.push(e.line);
    } else if (pod.kind === 'test') {
      lines.push(`${iso0(pod.created + 800)} ${cont}: listening`);
      for (const e of S.plog[pod.ns + '/' + pod.name] || []) if (cont === 'tcp') lines.push(e.line);
    } else lines.push(`${iso0(pod.created)} started`);
    let shown = lines;
    if (f.tail) shown = lines.slice(-Math.max(1, parseInt(f.tail, 10) || 10));
    ctx.out(shown.join('\n'));
    if (pod.kind === 'kiada' && cont === 'kiada' && (S.plog[pod.ns + '/' + pod.name] || []).some((e) => e.note)) ctx.hint('The indented host=... line is added by this page, not by the app: it shows what the gateway changed in the request before it reached the pod.');
  }

  // ---------- networking tools ----------
  function parseUrl(u) {
    let scheme = 'http';
    const m = u.match(/^(\w+):\/\//);
    if (m) { scheme = m[1].toLowerCase(); u = u.slice(m[0].length); }
    u = u.split('#')[0];
    const slash = u.search(/[/?]/);
    const hostport = slash >= 0 ? u.slice(0, slash) : u;
    let rest = slash >= 0 ? u.slice(slash) : '/';
    if (rest[0] === '?') rest = '/' + rest;
    const qi = rest.indexOf('?');
    const path = (qi >= 0 ? rest.slice(0, qi) : rest) || '/';
    const rawQuery = qi >= 0 ? rest.slice(qi + 1) : '';
    const query = rawQuery ? rawQuery.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); const d = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } }; return i < 0 ? [d(kv), ''] : [d(kv.slice(0, i)), d(kv.slice(i + 1))]; }) : [];
    let [host, port] = hostport.split(':');
    port = port ? Number(port) : scheme === 'https' ? 443 : 80;
    return { scheme, host: (host || '').toLowerCase(), port, path, rawQuery, query };
  }
  const isIP = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h);
  function hostsLookup(h) {
    for (const line of S.hosts) { const [ip, ...names] = line.trim().split(/\s+/); if (names.includes(h)) return ip; }
    if (h === 'localhost') return '127.0.0.1';
    return null;
  }
  function gatewayAt(cv, ip) { return cv.gwList.find((gv) => gv.g.ip === ip) || null; }
  function tlsCertInfo(gv, lst) {
    const name = lst && lst.tls && (lst.tls.certificateRefs || [])[0];
    const sec = name ? S.secrets[(name.namespace || gv.g.ns) + '/' + name.name] : S.secrets[NS + '/kiada-tls'];
    return { ok: !!sec, created: (sec && sec.created) || now() };
  }
  const TLS_V = ['* ALPN: curl offers h2,http/1.1', '* TLSv1.3 (OUT), TLS handshake, Client hello (1):', '* TLSv1.3 (IN), TLS handshake, Server hello (2):', '* TLSv1.3 (IN), TLS handshake, Encrypted Extensions (8):', '* TLSv1.3 (IN), TLS handshake, Certificate (11):', '* TLSv1.3 (IN), TLS handshake, CERT verify (15):', '* TLSv1.3 (IN), TLS handshake, Finished (20):', '* TLSv1.3 (OUT), TLS handshake, Finished (20):', '* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384 / X25519 / RSASSA-PSS'];

  function parseCurl(argv, ctx) {
    const o = { headers: [], resolve: [], v: false, k: false, I: false, i: false, s: false, url: null, method: null, out: null, w: null, data: null };
    const takes = new Set(['-m', '--max-time', '--connect-timeout', '-A', '--user-agent', '-u', '--user', '-e', '--referer', '-b', '--cookie', '--retry', '--cacert', '--proxy', '-x', '--interface']);
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '-v' || a === '--verbose') o.v = true;
      else if (a === '-k' || a === '--insecure') o.k = true;
      else if (a === '-I' || a === '--head') o.I = true;
      else if (a === '-H' || a === '--header') o.headers.push(argv[++i] || '');
      else if (a === '--resolve') o.resolve.push(argv[++i] || '');
      else if (a === '-X' || a === '--request') o.method = (argv[++i] || 'GET').toUpperCase();
      else if (a === '-o' || a === '--output') o.out = argv[++i];
      else if (a === '-w' || a === '--write-out') o.w = argv[++i];
      else if (a === '-d' || a === '--data' || a === '--data-raw' || a === '--data-binary') o.data = argv[++i] || '';
      else if (a === '-s' || a === '--silent') o.s = true;
      else if (a === '-i' || a === '--include') o.i = true;
      else if (a === '-L' || a === '--location') o.L = true;
      else if (['-S', '--show-error', '-f', '--fail', '-4', '-6', '--http1.1', '--http2', '--http2-prior-knowledge', '-g', '--compressed', '-N'].includes(a)) { /* ignored */ }
      else if (takes.has(a)) i++;
      else if (/^-[vkIsSLi]+$/.test(a)) { if (a.includes('v')) o.v = true; if (a.includes('k')) o.k = true; if (a.includes('I')) o.I = true; if (a.includes('i')) o.i = true; if (a.includes('s')) o.s = true; if (a.includes('L')) o.L = true; }
      else if (a.startsWith('-') && a.length > 1) { ctx.err(`curl: option ${a}: is unknown`); ctx.err("curl: try 'curl --help' or 'curl --manual' for more information"); return null; }
      else o.url = a;
    }
    if (!o.method) o.method = o.I ? 'HEAD' : o.data !== null ? 'POST' : 'GET';
    return o;
  }

  async function curl(argv, ctx) {
    const o = parseCurl(argv, ctx);
    if (!o) return;
    if (!o.url) { ctx.err("curl: no URL specified!\ncurl: try 'curl --help' or 'curl --manual' for more information"); return; }
    if (/^https?:\/\/istio\.io\/downloadIstioctl/.test(o.url)) { ctx.out('#!/bin/sh\n# istio.io/downloadIstioctl: downloads istioctl to ~/.istioctl/bin\nISTIO_VERSION="${ISTIO_VERSION:-' + ISTIO_VERSION + '}"\n...'); return; }
    const u = parseUrl(o.url);
    if (!['http', 'https'].includes(u.scheme)) { ctx.err(`curl: (1) Protocol "${u.scheme}" not supported`); return; }
    const V = (s) => { if (o.v) ctx.out(s, 'dim'); };
    const fail = (msg) => { ctx.err(msg); };
    let ip = null, cached = false;
    for (const r of o.resolve) {
      const [h, p, addr] = r.split(':');
      V(`* Added ${h}:${p}:${addr} to DNS cache`);
      if (h.toLowerCase() === u.host && Number(p) === u.port) { ip = addr; cached = true; }
    }
    if (!ip) ip = isIP(u.host) ? u.host : hostsLookup(u.host);
    if (!ip) {
      V(`* Could not resolve host: ${u.host}`);
      fail(`curl: (6) Could not resolve host: ${u.host}`);
      if (/example\.com$/.test(u.host)) ctx.hint(`Nothing maps ${u.host} to the gateway's IP. Either pass --resolve ${u.host}:${u.port}:172.18.255.200 or add it to /etc/hosts: echo "172.18.255.200 ${u.host}" | sudo tee -a /etc/hosts`);
      return;
    }
    if (cached) V(`* Hostname ${u.host} was found in DNS cache`);
    V(`*   Trying ${ip}:${u.port}...`);
    const cv = clusterView();
    const gv = gatewayAt(cv, ip);
    const hostShown = u.host;
    if (!gv) {
      if (ip === '127.0.0.1') { V(`* connect to ${ip} port ${u.port} failed: Connection refused`); fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 0 ms: Couldn't connect to server`); return; }
      await ctx.sleep(500);
      V(`* connect to ${ip} port ${u.port} failed: No route to host`);
      fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 3082 ms: No route to host`);
      const anyGw = cv.gwList.length;
      ctx.hint(anyGw ? `No Gateway owns ${ip}. Gateways here: ${cv.gwList.map((g) => g.g.name + ' ' + g.g.ip).join(', ')}.` : `No Gateway has been assigned ${ip}: nothing exists to answer. Create a Gateway (section 13.2.3).`);
      return;
    }
    if (!gv.programmed) {
      V(`* connect to ${ip} port ${u.port} failed: Connection refused`);
      fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 0 ms: Connection refused`);
      ctx.hint(!controllerInstalled() ? 'The Gateway object exists, but no controller (Istio) is running, so no proxy listens on its address. See section 13.1.3.' : !controllerReady() ? 'istiod is still starting, so the Gateway is not programmed yet. Try again in a few seconds.' : gv.managed ? 'The Gateway is still being programmed. Try again in a second.' : 'No controller claims this Gateway (check its gatewayClassName).');
      return;
    }
    const wantTls = u.scheme === 'https';
    const portListeners = gv.listeners.filter((l) => l.port === u.port && !l.broken && !l.udp);
    if (!portListeners.length) {
      await ctx.sleep(500);
      V(`* connect to ${ip} port ${u.port} failed: No route to host`);
      fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 3082 ms: No route to host`);
      ctx.hint(`The gateway's Service only exposes the ports of its listeners (${[...new Set(gv.listeners.map((l) => l.port))].join(', ')}). There is no listener on port ${u.port}.`);
      return;
    }
    V(`* Connected to ${hostShown} (${ip}) port ${u.port}`);
    const userHost = (o.headers.map((h) => h.split(/:\s*(.*)/s)).find(([k]) => k.toLowerCase() === 'host') || [])[1];
    const reqHost = (userHost || u.host).replace(/:\d+$/, '').toLowerCase();
    const sniHost = u.host;
    const pick = (cands, h) => { let best = null, bs = -1; for (const l of cands) { const sc = hostMatchScore(l.hostname, h); if (sc > bs) { bs = sc; best = l; } } return best; };
    const httpL = portListeners.filter((l) => l.protocol === 'HTTP'), httpsL = portListeners.filter((l) => l.protocol === 'HTTPS'), tlsL = portListeners.filter((l) => l.protocol === 'TLS'), tcpL = portListeners.filter((l) => l.protocol === 'TCP');
    let lst = null, mode = null;
    if (!wantTls) {
      if (httpL.length) { lst = pick(httpL, reqHost); mode = 'http'; }
      else if (tcpL.length) mode = 'tcp';
      else { V('* Empty reply from server'); fail('curl: (52) Empty reply from server'); ctx.hint('That port is a TLS listener. Talk TLS to it: use https://.'); return; }
    } else {
      if (tlsL.length || httpsL.length) {
        const cands = [...httpsL, ...tlsL];
        lst = pick(cands, sniHost);
        if (!lst) { fail('curl: (35) Recv failure: Connection reset by peer'); ctx.hint('No listener on this port matches the TLS server name (SNI).'); return; }
        mode = lst.protocol === 'HTTPS' ? 'https' : (lst.tls && lst.tls.mode === 'Terminate' ? 'tlsterm' : 'passthrough');
      } else {
        TLS_V.slice(0, 3).forEach(V);
        fail('curl: (35) error:0A00010B:SSL routines::wrong version number');
        ctx.hint(httpL.length ? 'This port is a plain HTTP listener, so the TLS handshake fails. Add an HTTPS listener (section 13.4.1) or use http://.' : 'That port is a TCP listener, not TLS.');
        return;
      }
    }
    if (mode === 'tcp') {
      const r = tcpExchange(gv, tcpL[0], 'GET / HTTP/1.1', cv);
      if (r.refused) { fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 0 ms: Connection refused`); ctx.hint('The TCP listener has no attached TCPRoute, so connections are refused.'); return; }
      fail('curl: (1) Received HTTP/0.9 when not allowed');
      ctx.hint('The TCP backend answered, but it does not speak HTTP. Use nc for TCP listeners.');
      save();
      return;
    }
    // TLS handshake
    let h2 = false;
    let certOk = true;
    if (wantTls) {
      const info = tlsCertInfo(gv, lst);
      if (mode === 'https' && lst.refErr) { fail('curl: (35) OpenSSL/3.0.13: error:0A000438:SSL routines::tlsv1 alert internal error'); ctx.hint(`The listener's certificateRef is broken (${lst.refErr.reason}): ${lst.refErr.message}. Check kubectl get gtw ${gv.g.name} -o yaml.`); return; }
      if (mode === 'passthrough') {
        const px = passthrough(gv, lst, { scheme: 'https', host: sniHost, port: u.port, path: u.path, rawQuery: u.rawQuery, query: u.query, method: o.method, headers: [['Host', reqHost], ['User-Agent', 'curl/8.5.0'], ['Accept', '*/*']] }, cv, false);
        if (px.refused) {
          V(`* connect to ${ip} port ${u.port} failed: Connection refused`);
          fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 0 ms: Connection refused`);
          ctx.hint(cv.routeList.some((rv) => rv.r.kind === 'TLSRoute') ? 'No TLSRoute attached to this listener matches the SNI hostname (or its backend has no endpoints). Check the TLSRoute status.' : 'A TLS Passthrough listener only works with TLSRoute objects, and there are none attached yet (section 13.4.2).');
          return;
        }
      }
      if (o.v) {
        TLS_V.forEach(V); V('* ALPN: server accepted ' + (mode === 'passthrough' ? 'http/1.1' : 'h2')); V('* Server certificate:');
        if (info.ok) { V(`*  subject: CN=${sniHost.endsWith('example.com') ? 'kiada.example.com' : 'kiada.example.com'}`); V(`*  start date: ${certDate(info.created)}`); V(`*  expire date: ${certDate(info.created + 365 * 86400e3)}`); if (sniHost === 'kiada.example.com') V(`*  subjectAltName: host "${sniHost}" matched cert's "kiada.example.com"`); else V(`*  subjectAltName does not match ${sniHost}`); V('*  issuer: CN=kiada.example.com'); }
      }
      certOk = false;   // self-signed
      if (!o.k) {
        fail('curl: (60) SSL certificate problem: self-signed certificate');
        ctx.out('More details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it. To learn more about this situation and\nhow to fix it, please visit the web page mentioned above.', 'dim');
        ctx.hint('The kiada-tls certificate is self-signed, so curl cannot verify it. For a lab, -k skips the check.');
        return;
      }
      V('*  SSL certificate verify result: self-signed certificate (18), continuing anyway.');
      h2 = mode !== 'passthrough';
    }
    // build client headers
    const hdrs = [['Host', reqHost + (!userHost && u.port !== 80 && u.port !== 443 ? ':' + u.port : '')], ['User-Agent', 'curl/8.5.0'], ['Accept', '*/*']];
    for (const h of o.headers) {
      const i = h.indexOf(':');
      if (i < 0) continue;
      const name = h.slice(0, i).trim(), val = h.slice(i + 1).trim();
      const ix = findHdr(hdrs, name);
      if (ix >= 0 && ix < 3) { if (val === '') hdrs.splice(ix, 1); else hdrs[ix] = [hdrs[ix][0], val]; }
      else if (val !== '') hdrs.push([name, val]);
    }
    if (o.data !== null) { hdrs.push(['Content-Length', String(o.data.length)], ['Content-Type', 'application/x-www-form-urlencoded']); }
    const req = { scheme: u.scheme, host: reqHost, port: u.port, path: u.path, rawQuery: u.rawQuery, query: u.query, method: o.method, headers: hdrs.map((h) => [h[0], h[1]]), clientIp: gv.pod ? gv.pod.ip : '10.244.1.9' };
    const proto = h2 ? 'HTTP/2' : 'HTTP/1.1';
    if (o.v) {
      if (h2) V('* using HTTP/2');
      ctx.out(`> ${o.method} ${u.path}${u.rawQuery ? '?' + u.rawQuery : ''} ${proto}\n${hdrs.map(([k, v]) => `> ${k}: ${v}`).join('\n')}\n>`, 'dim');
    }
    let res;
    if (mode === 'passthrough') res = passthrough(gv, lst, req, cv, true);
    else res = httpExchange(gv, lst, req, cv, true);
    if (res.notTls) { fail('curl: (35) error:0A00010B:SSL routines::wrong version number'); ctx.hint('The TLSRoute backend port is not the TLS port of the pods (the Envoy sidecar listens on 8443, which is service port 443).'); save(); return; }
    if (res.refused) { fail(`curl: (7) Failed to connect to ${hostShown} port ${u.port} after 0 ms: Connection refused`); return; }
    save();
    const status = h2 ? `HTTP/2 ${res.status}` : `HTTP/1.1 ${res.status} ${STATUS_TEXT[res.status] || ''}`.trim();
    let hl;
    if (res.status === 404 || res.status === 500 && !res.headers.length) {
      hl = [status, ['date', httpDate()], ['server', 'istio-envoy'], ['content-length', '0']].map((x) => Array.isArray(x) ? x : [x]);
    } else if (res.redirect) {
      hl = [[status], ...res.headers, ['date', httpDate()], ['server', 'istio-envoy'], ['content-length', '0']];
    } else hl = [[status], ...res.headers];
    const hlines = hl.map((x) => x.length === 1 ? x[0] : `${x[0]}: ${x[1]}`);
    if (o.v) ctx.out(hlines.map((l) => '< ' + l).join('\n') + '\n<', 'dim');
    else if (o.I || o.i) ctx.out(hlines.join('\n') + (o.i && !o.I ? '\n' : ''), '');
    const body = o.I || o.method === 'HEAD' ? '' : res.body;
    if (!o.I && body && o.out !== '/dev/null') ctx.out(body);
    if (o.v) V(`* Connection #0 to host ${hostShown} left intact`);
    if (o.w) ctx.out(o.w.replace(/%\{http_code\}/g, String(res.status)).replace(/\\n/g, '\n'));
    if (!o.v && !o.I && !o.i && !o.w) {
      if (res.redirect) ctx.hint(`The gateway answered with a ${res.status} redirect and no body, so curl printed nothing. Add -v or -I to see the Location header.`);
      else if (res.status === 404) ctx.hint(`404 from the gateway (empty body): no route matched. Add -I to see the response headers.${hostShown !== reqHost ? '' : ''}`);
      else if (res.status === 500) ctx.hint(`500 from the gateway (empty body): the matched rule has a backend it cannot use (${res.reason || 'unresolved reference'}). Check the HTTPRoute status.`);
      else if (res.status === 503 && /no healthy upstream/.test(res.body || '')) { /* body says it */ }
    }
    if (o.L && res.redirect) ctx.hint('curl -L would follow the redirect; this simulator prints the redirect response instead.');
  }

  async function nc(argv, ctx) {
    const args = argv.filter((a) => !['-v', '-n', '-N', '-z', '-vv', '-4', '-6'].includes(a));
    let udp = false;
    const pos = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-u' || a === '--udp') udp = true;
      else if (a === '-w' || a === '-q' || a === '-W') i++;
      else if (a.startsWith('-')) { /* ignore */ }
      else pos.push(a);
    }
    const [h, p] = pos;
    if (!h || !p) { ctx.err('usage: nc [-options] hostname port[s] [ports] ...'); return; }
    const hasStdin = ctx.stdin !== undefined && ctx.stdin !== null;
    let ip = isIP(h) ? h : hostsLookup(h);
    if (!ip) { ctx.err(`nc: getaddrinfo for host "${h}" port ${p}: Name or service not known`); return; }
    const port = Number(p);
    const cv = clusterView();
    const gv = gatewayAt(cv, ip);
    const proto = udp ? 'udp' : 'tcp';
    if (udp) {
      ctx.hint('No reply came back. UDP has no connection to fail, so nc just waits. Istio (in the book\'s version) doesn\'t implement UDPRoute: check kubectl get udproute test -o yaml, it has no status.');
      return;
    }
    if (!gv) { await ctx.sleep(400); ctx.err(`nc: connect to ${h} port ${port} (${proto}) failed: No route to host`); return; }
    const lst = gv.programmed ? gv.listeners.find((l) => l.port === port && !l.broken && !l.udp) : null;
    if (!gv.programmed) { ctx.err(`nc: connect to ${h} port ${port} (${proto}) failed: Connection refused`); ctx.hint('The Gateway is not programmed: no proxy listens on its address yet.'); return; }
    if (!lst) { ctx.err(`nc: connect to ${h} port ${port} (${proto}) failed: ${gv.listeners.some((l) => l.port === port) ? 'Connection refused' : 'Connection refused'}`); ctx.hint(`The gateway has no TCP listener on port ${port}. Add one to the Gateway (section 13.5.1).`); return; }
    if (lst.protocol !== 'TCP') {
      if (!hasStdin) { ctx.hint('That is an HTTP/TLS listener. Use curl instead of nc.'); return; }
      ctx.out('HTTP/1.1 400 Bad Request\ncontent-length: 0\nconnection: close');
      return;
    }
    if (!hasStdin) { ctx.hint('This shell is not interactive, so nc has no keyboard to read. Pipe the text in instead: echo hello | nc ' + ip + ' ' + port); return; }
    const text = String(ctx.stdin).split('\n')[0];
    const r = tcpExchange(gv, lst, text, cv);
    save();
    if (r.refused) { ctx.err(`nc: connect to ${h} port ${port} (tcp) failed: Connection refused`); ctx.hint('The TCP listener exists, but no TCPRoute is attached to it (check the TCPRoute status).'); return; }
    if (r.closed) { ctx.hint(`The connection was accepted and then closed: ${r.why}.`); return; }
    ctx.out(r.reply);
  }

  async function grpcurl(argv, ctx) {
    const pos = argv.filter((a, i) => !a.startsWith('-') && argv[i - 1] !== '-proto' && argv[i - 1] !== '-d');
    const [target, method] = pos;
    if (!target) { ctx.err('Too few arguments.\nUsage:\n\tgrpcurl [flags] [address] [list|describe] [symbol]'); return; }
    const [h, p] = target.split(':');
    const ip = isIP(h) ? h : hostsLookup(h);
    const cv = clusterView();
    if (!ip) { ctx.err(`Failed to dial target host "${target}": dial tcp: lookup ${h} on 127.0.0.53:53: no such host`); ctx.hint('Nothing resolves test.example.com yet. Add it to /etc/hosts: echo "172.18.255.201 test.example.com" | sudo tee -a /etc/hosts. Note: the book\'s Istio did not support GRPCRoute, so even then the call fails; with a working implementation it would print { "text": "pong" }.'); return; }
    const gv = gatewayAt(cv, ip);
    if (!gv || !gv.programmed || !gv.listeners.some((l) => l.port === Number(p) && !l.udp)) { await ctx.sleep(300); ctx.err(`Failed to dial target host "${target}": dial tcp ${ip}:${p}: connect: ${gv && gv.programmed ? 'connection refused' : 'no route to host'}`); ctx.hint('No gateway listens at that address and port. (Also: the book\'s Istio did not support GRPCRoute.)'); return; }
    ctx.err('ERROR:\n  Code: Unimplemented\n  Message: ');
    ctx.hint(`The gateway answered, but nothing routes gRPC: Istio (in the book's version) doesn't implement GRPCRoute, so ${method || 'the call'} gets Unimplemented. With a working implementation you'd see { "text": "pong" }. Check kubectl get grpcroute test -o yaml: no status.`);
  }

  async function istioctl(argv, ctx) {
    if (!S.istioctl) {
      ctx.err('bash: istioctl: command not found');
      ctx.hint('istioctl is not installed yet. Download it with: curl -sL https://istio.io/downloadIstioctl | sh -   (section 13.1.3)');
      return;
    }
    const sub = argv[0];
    if (sub === 'install') {
      const prof = ((argv.find((a) => /^profile=/.test(a)) || '').split('=')[1]) || ((argv[argv.indexOf('--set') + 1] || '').split('=')[1]) || 'default';
      const L = ['        |\\          ', '        | \\         ', '        |  \\        ', '        |   \\       ', '      /||    \\      ', '     / ||     \\     ', '    /  ||      \\    ', '   /   ||       \\   ', '  /    ||        \\  ', ' /     ||         \\ ', '/______||__________\\', '____________________', '  \\__       _____/  ', '     \\_____/        ', ''];
      if (!argv.includes('-y') && !argv.includes('--yes')) { ctx.out(`This will install the Istio ${ISTIO_VERSION} profile "${prof}" into the cluster. Proceed? (y/N)`); ctx.hint('Add -y to skip the confirmation: istioctl install -y --set profile=minimal'); return; }
      if (S.istio) { ctx.out(L.join('\n')); ctx.out('✔ Istio core installed\n✔ Istiod installed\n✔ Installation complete'); ctx.hint('Istio was already installed: nothing changed.'); return; }
      ctx.out(L.join('\n'), 'dim');
      await ctx.sleep(500); ctx.out('✔ Istio core installed');
      await ctx.sleep(900); ctx.out('✔ Istiod installed');
      await ctx.sleep(700); ctx.out('✔ Installation complete');
      installIstio();
      save();
      ctx.out('Making this installation the default for injection and validation.', 'dim');
      ctx.hint('istiod takes ~10s to become Ready. Check: kubectl get pods -n istio-system');
      if (!crdsInstalled()) ctx.hint('The Gateway API CRDs are not installed (section 13.1.3), so Istio creates no GatewayClass. Apply them: kubectl apply -k github.com/kubernetes-sigs/gateway-api/config/crd/experimental');
      return;
    }
    if (sub === 'version') { ctx.out(`client version: ${ISTIO_VERSION}\n` + (S.istio ? `control plane version: ${ISTIO_VERSION}\ndata plane version: none` : 'no running Istio pods in "istio-system"')); return; }
    if (sub === 'x' && argv[1] === 'precheck') { ctx.out('✔ No issues found when checking the cluster. Istio is safe to install or upgrade!\n  To get started, check out https://istio.io/latest/docs/setup/getting-started/'); return; }
    ctx.out('(this simulator supports: istioctl install -y --set profile=minimal, istioctl version)', 'hint');
  }

  async function shDownload(ctx) {
    ctx.out(`Downloading istioctl-${ISTIO_VERSION}-linux-amd64.tar.gz from https://github.com/istio/istio/releases/download/${ISTIO_VERSION}/istioctl-${ISTIO_VERSION}-linux-amd64.tar.gz ...`, 'dim');
    await ctx.sleep(500);
    S.istioctl = true; save();
    ctx.out(`istioctl-${ISTIO_VERSION}-linux-amd64.tar.gz download complete!

istioctl ${ISTIO_VERSION} was saved to ~/.istioctl/bin

Add the istioctl to your path with:
  export PATH=$HOME/.istioctl/bin:$PATH

Begin the Istio pre-installation check by running:
\t istioctl x precheck

Need more information? Visit https://istio.io/latest/docs/reference/commands/istioctl/`);
  }

  // ---------- generic filters ----------
  function isStdout(c) { return !c || c === 'yaml' || c === 'ls' || c === ''; }
  function grepLines(argv, input, ctx) {
    const o = { i: false, o: false, v: false, c: false, F: false, n: false };
    let pat = null, A = 0, B = 0;
    for (let k = 0; k < argv.length; k++) {
      const a = argv[k];
      let m;
      if (pat === null && (m = a.match(/^-([ABC])(\d*)$/))) { const n = m[2] !== '' ? parseInt(m[2], 10) : parseInt(argv[++k], 10) || 0; if (m[1] !== 'B') A = n; if (m[1] !== 'A') B = n; }
      else if (a.startsWith('-') && a.length > 1 && pat === null) { for (const ch of a.slice(1)) if (ch in o) o[ch] = true; }
      else if (pat === null) pat = a;
    }
    if (pat === null) { ctx.err('Usage: grep [OPTION]... PATTERNS [FILE]...'); return []; }
    let re;
    try { re = new RegExp(o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pat.replace(/\\\|/g, '|'), o.i ? 'i' : ''); } catch (e) { ctx.err('grep: Invalid regular expression'); return []; }
    const lines = String(input).split('\n');
    if (o.c) return [String(lines.filter((l) => re.test(l) !== o.v).length)];
    const out = [];
    if ((A || B) && !o.o) {
      const keep = new Set();
      lines.forEach((l, i) => { if (re.test(l) !== o.v) for (let j = Math.max(0, i - B); j <= Math.min(lines.length - 1, i + A); j++) keep.add(j); });
      let prev = -2;
      for (const j of [...keep].sort((x, y) => x - y)) { if (prev >= 0 && j > prev + 1) out.push('--'); out.push((o.n ? (j + 1) + ':' : '') + lines[j]); prev = j; }
      return out;
    }
    lines.forEach((l, i) => {
      const hit = re.test(l);
      if (hit === o.v) return;
      if (o.o && !o.v) { const g = new RegExp(re.source, o.i ? 'gi' : 'g'); let m; while ((m = g.exec(l))) { out.push((o.n ? (i + 1) + ':' : '') + m[0]); if (!m[0]) g.lastIndex++; } }
      else out.push((o.n ? (i + 1) + ':' : '') + l);
    });
    return out;
  }

  // run a single simple command (no pipes). Output through ctx.
  async function runCmd(rawcmd, ctx) {
    const argv = tokenize(rawcmd);
    let cmd = argv.shift();
    if (!cmd) return;
    if (cmd === 'sudo') cmd = argv.shift();
    if (cmd === 'k') cmd = 'kubectl';
    const hasIn = ctx.stdin !== undefined && ctx.stdin !== null;
    switch (cmd) {
      case 'help': case '?': ctx.out(HELP); return;
      case 'clear': case 'cls': ctx.clear(); return;
      case 'history': ctx.out(S.history.map((h, i) => String(i + 1).padStart(4) + '  ' + h).join('\n')); return;
      case 'reset': {
        const h = S.history; S = fresh(); S.history = h; save();
        ctx.ok('Cluster reset: kiada, quote and quiz are running; no Gateway API CRDs, no Istio, no Gateways.');
        return;
      }
      case 'catchup': catchup(argv[0] || '', ctx); return;
      case 'pwd': ctx.out('/home/kiada/Chapter13'); return;
      case 'whoami': ctx.out('kiada'); return;
      case 'date': ctx.out(new Date().toString()); return;
      case 'sleep': await ctx.sleep(Math.min(1, Number(argv[0]) || 0) * 400); return;
      case 'exit': case 'logout': ctx.out('nice try. there is no outside. (Esc closes the drop-down shell)', 'hint'); return;
      case 'export': case 'cd': case 'source': case 'alias': case 'set': case 'unset': return;
      case 'echo': {
        const a = argv.slice(); let nl = true;
        if (a[0] === '-n') { a.shift(); nl = false; }
        ctx.out(a.join(' ') + (nl ? '' : ''));
        return;
      }
      case 'ls': case 'll': case 'dir': {
        const target = argv.filter((a) => !a.startsWith('-'))[0];
        if (target && target.replace(/\/$/, '') === 'SETUP') { ctx.out(DIRS.SETUP.join('  ')); return; }
        if (target) { ctx.err(`ls: cannot access '${target}': No such file or directory`); return; }
        const names = ['SETUP/', ...Object.keys(FILES).concat(['yages-schema.proto']).sort()];
        ctx.out(names.map((n) => n.endsWith('/') ? `\u0001${n}\u0002` : n).join('\n'), 'ls');
        return;
      }
      case 'cat': case 'less': case 'more': case 'bat': {
        const fl = argv.filter((a) => !a.startsWith('-'))[0];
        if (!fl) { if (hasIn) { ctx.out(String(ctx.stdin)); return; } ctx.err('cat: missing operand'); return; }
        if (fl === '/etc/hosts') { ctx.out(['127.0.0.1   localhost', '::1         localhost ip6-localhost ip6-loopback', ...S.hosts].join('\n')); return; }
        const clean = fl.replace(/^\.\//, '');
        if (FILES[clean]) { ctx.out(FILES[clean], 'yaml'); return; }
        if (clean === 'yages-schema.proto') { ctx.out(PROTO_FILE); return; }
        if (clean.startsWith('SETUP/')) { ctx.out('(chapter 11 manifest: pods, services and secret of the kiada suite, already applied)', 'hint'); return; }
        if (clean === 'SETUP') { ctx.err('cat: SETUP: Is a directory'); return; }
        ctx.err(`cat: ${fl}: No such file or directory`);
        return;
      }
      case 'kubectl': return kubectl(argv, ctx);
      case 'curl': return curl(argv, ctx);
      case 'istioctl': return istioctl(argv, ctx);
      case 'nc': case 'ncat': case 'netcat': return nc(argv, ctx);
      case 'grpcurl': return grpcurl(argv, ctx);
      case 'gcloud': {
        if (argv[0] === 'container' && argv[1] === 'clusters' && argv[2] === 'update') {
          ctx.err('ERROR: (gcloud.container.clusters.update) You do not currently have an active account selected.');
          ctx.hint('That command enables the Gateway API on a GKE cluster. This is a kind cluster, so nothing changes here: on GKE you wouldn\'t install CRDs or Istio at all, Google provides both. Keep following with the kind steps.');
          return;
        }
        ctx.out('(this simulator only knows: gcloud container clusters update <name> --gateway-api=standard --region=<region>)', 'hint');
        return;
      }
      case 'tee': {
        const files = argv.filter((a) => !a.startsWith('-'));
        const append = argv.includes('-a');
        if (files[0] === '/etc/hosts') {
          if (!hasIn) return;
          const lines = String(ctx.stdin).split('\n').filter(Boolean);
          if (!append) S.hosts = [];
          S.hosts.push(...lines); save();
          ctx.out(lines.join('\n'));
          if (!append) ctx.hint('Without -a, tee overwrote /etc/hosts (localhost lines are kept here for your sanity).');
          return;
        }
        if (hasIn) ctx.out(String(ctx.stdin));
        return;
      }
      case 'sh': case 'bash': {
        if (hasIn && /downloadIstioctl|istio\.io/.test(String(ctx.stdin))) return shDownload(ctx);
        if (hasIn) { ctx.out('(this simulator only runs the istioctl download script through sh)', 'hint'); return; }
        ctx.out('(no nested shells in the simulator)', 'hint');
        return;
      }
      case 'grep': case 'egrep': case 'fgrep': {
        if (!hasIn) { ctx.err('grep: this simulator only filters piped output: kubectl get gtw | grep kiada'); return; }
        const a = cmd === 'fgrep' ? ['-F', ...argv] : argv;
        const r = grepLines(a, ctx.stdin, ctx);
        if (r.length) ctx.out(r.join('\n'));
        return;
      }
      case 'sort': { if (!hasIn) return; const l = String(ctx.stdin).split('\n').filter((x, i, arr) => x !== '' || arr.length === 1); l.sort(); if (argv.includes('-r')) l.reverse(); ctx.out(l.join('\n')); return; }
      case 'uniq': { if (!hasIn) return; const l = String(ctx.stdin).split('\n').filter(Boolean); const out = []; for (const x of l) { const last = out[out.length - 1]; if (last && last[0] === x) last[1]++; else out.push([x, 1]); } ctx.out(out.map(([x, n]) => argv.includes('-c') ? String(n).padStart(7) + ' ' + x : x).join('\n')); return; }
      case 'wc': { if (!hasIn) return; const l = String(ctx.stdin).split('\n').filter((x, i, a) => i < a.length - 1 || x !== ''); ctx.out(argv.includes('-l') ? String(l.length) : `${l.length} ${String(ctx.stdin).split(/\s+/).filter(Boolean).length} ${String(ctx.stdin).length}`); return; }
      case 'head': case 'tail': {
        if (!hasIn) return;
        let n = 10; const ni = argv.findIndex((a) => /^-n$/.test(a)); if (ni >= 0) n = parseInt(argv[ni + 1], 10) || 10; else { const m = argv.find((a) => /^-\d+$/.test(a)); if (m) n = -parseInt(m, 10); }
        const l = String(ctx.stdin).split('\n'); ctx.out((cmd === 'head' ? l.slice(0, n) : l.slice(-n)).join('\n')); return;
      }
      case 'nslookup': case 'dig': case 'host': {
        const h = argv.filter((a) => !a.startsWith('-') && !a.startsWith('+'))[0];
        if (!h) { ctx.err(`${cmd}: missing host`); return; }
        ctx.out(`Server:\t\t1.1.1.1\nAddress:\t1.1.1.1#53\n\n** server can't find ${h}: NXDOMAIN`);
        if (hostsLookup(h)) ctx.hint(`${cmd} queries a DNS server directly and skips /etc/hosts, so it can't see your entry. curl does use /etc/hosts. Try: getent hosts ${h}`);
        else ctx.hint('example.com subdomains are not in public DNS. Use --resolve with curl, or add them to /etc/hosts.');
        return;
      }
      case 'getent': { const h = argv[1]; const ip = h && hostsLookup(h); if (ip) ctx.out(`${ip}      ${h}`); return; }
      case 'vim': case 'vi': case 'nano': case 'emacs': ctx.out(`${cmd}: no editors in here. (Escaping vim is chapter 0.)`, 'hint'); return;
      case 'rm': ctx.out("rm: let's not.", 'hint'); return;
      case 'kind': ctx.out('(the kind cluster is already up: kind-control-plane, kind-worker, kind-worker2)', 'hint'); return;
      case 'openssl': case 'minikube': ctx.out(`(not used in chapter 13: Istio's gateway IPs come from the kind cluster's load-balancer range, 172.18.255.200+)`, 'hint'); return;
      default:
        ctx.err(`bash: ${cmd}: command not found`);
        ctx.hint('Type help to see what this shell understands.');
    }
  }

  function mkCapture(real, stdin) {
    const buf = [];
    const c = {
      buf,
      out: (t, cls) => { if (isStdout(cls)) buf.push(String(t)); else real.out(t, cls); },
      err: (t) => real.err(t), hint: (t) => real.hint(t), ok: (t) => real.ok(t), sleep: real.sleep, clear: real.clear, stdin,
    };
    return c;
  }
  async function runPipeline(stages, ctx) {
    let input;
    for (let i = 0; i < stages.length; i++) {
      const last = i === stages.length - 1;
      const st = stages[i];
      const c = last ? (input === undefined ? ctx : Object.assign(Object.create(ctx), { out: ctx.out, err: ctx.err, hint: ctx.hint, ok: ctx.ok, sleep: ctx.sleep, clear: ctx.clear, stdin: input })) : mkCapture(ctx, input);
      if (last && input !== undefined) { c.out = ctx.out; }
      if (typeof st === 'function') await st(c); else await runCmd(st, c);
      if (!last) input = c.buf.join('\n');
    }
  }
  async function runLine(raw, ctx) {
    const lm = raw.match(/^for\s+(\w+)\s+in\s+\{(\d+)\.\.(\d+)\}\s*;\s*do\s+([\s\S]+?)\s*;?\s*done\s*((?:\|[\s\S]*)?)$/);
    if (lm) {
      const [, v, a, b, body, tail] = lm;
      const lo = Number(a), hi = Number(b);
      const n = Math.abs(hi - lo) + 1;
      if (n > 50) { ctx.err('bash: this simulator runs loops of up to 50 iterations'); return; }
      const hinted = new Set();
      const loopCtxFor = (c) => Object.assign({}, c, { hint: (t) => { if (!hinted.has(t)) { hinted.add(t); c.hint(t); } } });
      const first = async (c) => {
        const lc = loopCtxFor(c);
        for (let k = 0; k < n; k++) {
          const val = lo <= hi ? lo + k : lo - k;
          const cmdText = body.replace(new RegExp(`\\$\\{?${v}\\}?`, 'g'), String(val));
          for (const part of splitTop(cmdText, ';')) await runPipeline(splitTop(part, '|'), lc);
          await ctx.sleep(40);
        }
      };
      const rest = tail ? splitTop(tail.replace(/^\|/, ''), '|') : [];
      await runPipeline([first, ...rest], ctx);
      return;
    }
    for (const part of splitTop(raw, ';')) {
      const stages = splitTop(part, '|');
      if (!stages.length) continue;
      await runPipeline(stages, ctx);
    }
  }

  const HELP = `Simulated shell for chapter 13 · state is shared by every terminal on the page

  kubectl get gtw|gatewayclasses|httproutes|tlsroutes|tcproutes|udproutes|grpcroutes|referencegrants [name] [-n ns|-A] [-o yaml|wide]
  kubectl get pods|svc|endpoints|endpointslices|secrets|ns|crd [-l selector] [-o wide] · kubectl get ns --show-labels
  kubectl describe gtw|httproute <name>     kubectl apply -f <file>     kubectl apply -k <kustomize dir>
  kubectl delete -f <file> | <kind> <name>  kubectl label ns kiada part-of=kiada
  kubectl logs <pod> [-c container] [-n ns] kubectl explain gateway.spec
  kubectl create ns <name>                  kubectl config set-context --current --namespace <ns>
  curl [-v] [-k] [-I] [-s] [-X M] [-H "N: v"] [--resolve host:port:ip] <url>
  echo hi | nc <ip> <port> · nc --udp <ip> <port> · grpcurl -proto yages-schema.proto --plaintext host:900 yages.Echo.Ping
  curl -sL https://istio.io/downloadIstioctl | sh - · istioctl install -y --set profile=minimal · gcloud ...
  echo "<ip> <hosts>" | sudo tee -a /etc/hosts · for i in {1..10}; do <cmd>; done · <cmd> | grep [-o] [-i] <pattern>
  ls · ls SETUP · cat <file> · cat /etc/hosts · history · clear (Ctrl+L) · reset (fresh cluster) · catchup <section>, e.g. catchup 13.3.2

  Tab completes, ↑/↓ walks history, the \` key opens the drop-down shell.`;

  async function exec(line, ctx) {
    const raw = line.trim();
    if (!raw) return;
    if (raw !== S.history[S.history.length - 1]) { S.history.push(raw); if (S.history.length > 200) S.history.shift(); }
    save();
    if (/>>?\s*\/etc\/hosts/.test(raw)) { ctx.err('bash: /etc/hosts: Permission denied'); ctx.hint('The redirect runs as you, not as root. Use: echo "..." | sudo tee -a /etc/hosts'); return; }
    await runLine(raw, ctx);
  }

  // ---------- exports ----------
  function names() {
    const cv = clusterView();
    const byKind = (k) => cv.routeList.filter((rv) => rv.r.kind === k).map((rv) => rv.r.name);
    return {
      gateways: cv.gwList.map((g) => g.g.name), httproutes: byKind('HTTPRoute'), tlsroutes: byKind('TLSRoute'), tcproutes: byKind('TCPRoute'), udproutes: byKind('UDPRoute'), grpcroutes: byKind('GRPCRoute'),
      referencegrants: Object.values(S.grants).map((g) => g.name), pods: allPods(cv).filter((p) => p.ns === S.curNs).map((p) => p.name), services: allServices(cv).filter((s) => s.ns === S.curNs).map((s) => s.name),
      namespaces: Object.keys(S.namespaces), gatewayclasses: cv.classReady ? ['istio'] : [],
    };
  }
  window.SIM = {
    GROUP, CONTROLLER, ISTIO_VERSION, IP: '172.18.255.200',
    exec, state: () => S, on: (f) => { listeners.add(f); return () => listeners.delete(f); }, tokenize,
    view: clusterView, sendHttp, selectRoute, matchEntry, intersectHosts, hostMatchScore, hostScore, pathScore, splitPath, defaultSpec,
    controllerReady, controllerInstalled, crdsInstalled, controllerActive, podState, endpointsOf, names,
    completions: () => ({ files: [...Object.keys(FILES), 'yages-schema.proto', 'SETUP/'], names: names() }),
    sections: ORDER,
  };
})();
