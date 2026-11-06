// Page widgets: code blocks, quizzes, tabs, steppers + the chapter-13 labs
// (weight-splitter, httproute-lab, filter-lab, tls-modes, xns-lab, support-matrix).
// The labs are self-contained (no SIM dependency). Their pure logic lives in `L` and is
// exported as WIDGETS.logic so it can be unit-tested outside a browser.
(function () {
  const esc = (s) => (window.escHTML ? window.escHTML(s) : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const hlY = (t) => (window.hlYAML ? window.hlYAML(t) : esc(t));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const SVGNS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  // ---------- code blocks ----------
  function parseRanges(s) {
    const set = new Set();
    (s || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((r) => {
      const [a, b] = r.split('-').map(Number);
      for (let i = a; i <= (b || a); i++) set.add(i);
    });
    return set;
  }
  function codeBlock(el) {
    const src = el.dataset.src;
    const text = (window.FILES[src] || `# missing file: ${src}`);
    const hl = parseRanges(el.dataset.hl);
    const kinds = [...new Set((text.match(/^kind: (\w+)/gm) || []).map((k) => k.slice(6)))].join(' + ');
    const lines = hlY(text).split('\n');
    el.innerHTML = `
      <div class="code-head"><span class="fname">${esc(src)}</span>${kinds ? `<span class="kind">${esc(kinds)}</span>` : ''}
        <span class="code-actions"><button class="cbtn run" title="Run kubectl apply -f ${esc(src)} in the drop-down shell">▶ apply</button><button class="cbtn copy">copy</button></span></div>
      <pre><code>${lines.map((l, i) => `<span class="cl${hl.has(i + 1) ? ' hl' : ''}"><span class="n">${i + 1}</span>${l || ' '}</span>`).join('')}</code></pre>`;
    $('.copy', el).addEventListener('click', (e) => { navigator.clipboard && navigator.clipboard.writeText(text); e.target.textContent = 'copied'; setTimeout(() => (e.target.textContent = 'copy'), 1200); });
    $('.run', el).addEventListener('click', () => window.APP && window.APP.runInDock(`kubectl apply -f ${src}`));
  }

  // HTTP messages: request line, status line, header names.
  function hlHTTP(text) {
    return text.split('\n').map((l) => {
      let m = l.match(/^(GET|HEAD|POST|PUT|DELETE|PATCH|OPTIONS|CONNECT|TRACE)(\s+)(\S+)(\s+HTTP\/[\d.]+)?(.*)$/);
      if (m) return `<span class="y-dash">${esc(m[1])}</span>${m[2]}<span class="y-str">${esc(m[3])}</span><span class="y-com">${esc(m[4] || '')}</span>${esc(m[5])}`;
      m = l.match(/^(HTTP\/[\d.]+)(\s+)(\d{3})(.*)$/);
      if (m) return `<span class="y-com">${esc(m[1])}</span>${m[2]}<span class="${+m[3] >= 400 ? 'y-bad' : +m[3] >= 300 ? 'y-num' : 'y-ok'}">${esc(m[3])}</span>${esc(m[4])}`;
      m = l.match(/^([A-Za-z][\w-]*)(:)(.*)$/);
      if (m) return `<span class="y-key">${esc(m[1])}</span><span class="y-p">:</span><span class="y-val">${esc(m[3])}</span>`;
      return esc(l);
    }).join('\n');
  }
  function snippet(el) {
    const lang = el.dataset.lang;
    const text = el.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    if (lang === 'yaml') el.innerHTML = hlY(text);
    else if (lang === 'http') el.innerHTML = hlHTTP(text);
    else if (lang === 'bash' || lang === 'shell' || lang === 'sh') el.innerHTML = esc(text).replace(/^(\$ )/gm, '<span class="y-com">$1</span>');
    else el.textContent = text; // text, json, proto: plain
  }

  // ---------- quiz ----------
  function quiz(el) {
    const opts = $$('.opt', el);
    const explain = $('.explain', el);
    let wrong = 0;
    opts.forEach((o) => o.addEventListener('click', () => {
      if (el.classList.contains('solved')) return;
      if (o.hasAttribute('data-correct')) {
        o.classList.add('right');
        el.classList.add('solved', wrong === 0 ? 'first-try' : 'retry');
        opts.forEach((x) => (x.disabled = true));
        if (explain) explain.classList.add('show');
        document.dispatchEvent(new CustomEvent('quiz:solved'));
      } else {
        o.classList.add('wrong');
        o.disabled = true;
        wrong++;
        if (wrong >= 2 && explain) { explain.classList.add('show'); }
        el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      }
    }));
  }

  // ---------- tabs ----------
  function tabset(el) {
    const btns = $$(':scope > .tabs > button', el);
    const panels = $$(':scope > .tab-panel', el);
    const show = (t) => {
      btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
      panels.forEach((p) => (p.hidden = p.dataset.tab !== t));
    };
    btns.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    if (btns[0]) show(btns[0].dataset.tab);
  }

  // ---------- stepper ----------
  function stepper(fig) {
    const svg = $('svg', fig);
    const items = $$('[data-step]', svg);
    const lis = $$('ol.steps > li', fig);
    const max = Math.max(lis.length, ...items.map((e) => +e.dataset.step || 0));
    if (!max) return;
    let cur = 1, timer = null;
    const ctr = document.createElement('div');
    ctr.className = 'step-ctrl';
    ctr.innerHTML = `<button class="sb prev" aria-label="Previous step">◀</button><button class="sb play" aria-label="Play">▶ play</button><button class="sb next" aria-label="Next step">▶</button><span class="step-n"></span>`;
    svg.after(ctr);
    const render = () => {
      items.forEach((e) => { const n = +e.dataset.step; e.classList.toggle('st-on', n <= cur); e.classList.toggle('st-now', n === cur); });
      lis.forEach((li, i) => { li.classList.toggle('st-on', i + 1 <= cur); li.classList.toggle('st-now', i + 1 === cur); });
      $('.step-n', ctr).textContent = `step ${cur} / ${max}`;
    };
    const stop = () => { clearInterval(timer); timer = null; $('.play', ctr).textContent = '▶ play'; };
    const go = (n) => { cur = Math.max(1, Math.min(max, n)); render(); };
    $('.prev', ctr).onclick = () => { stop(); go(cur - 1); };
    $('.next', ctr).onclick = () => { stop(); go(cur + 1); };
    $('.play', ctr).onclick = () => {
      if (timer) return stop();
      if (cur >= max) go(1);
      $('.play', ctr).textContent = '❚❚ pause';
      timer = setInterval(() => { if (cur >= max) return stop(); go(cur + 1); }, 2300);
    };
    lis.forEach((li, i) => li.addEventListener('click', () => { stop(); go(i + 1); }));
    render();
    let played = false;
    new IntersectionObserver((ents) => ents.forEach((en) => {
      if (en.isIntersecting && !played) { played = true; setTimeout(() => { if (!timer && cur === 1) $('.play', ctr).click(); }, 600); }
    }), { threshold: 0.6 }).observe(fig);
  }

  // =====================================================================================
  //  Pure logic for the Gateway API labs (no DOM)
  // =====================================================================================
  const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } };
  const q = (s) => '"' + s + '"';
  const fmtPct = (x) => { const p = x * 100; return (Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)) + '%'; };
  const L = {};

  // --- request parsing ---
  L.splitPath = (p) => String(p).split('/').filter(Boolean);
  L.parseTarget = (t) => {
    t = String(t || '/').trim() || '/';
    const h = t.indexOf('#'); if (h >= 0) t = t.slice(0, h);
    const i = t.indexOf('?');
    let path = i < 0 ? t : t.slice(0, i);
    const qs = i < 0 ? '' : t.slice(i + 1);
    if (path[0] !== '/') path = '/' + path;
    const query = qs.split('&').filter(Boolean).map((kv) => { const j = kv.indexOf('='); return j < 0 ? [dec(kv), ''] : [dec(kv.slice(0, j)), dec(kv.slice(j + 1))]; });
    return { path, qs, query };
  };
  L.parseHeaders = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const i = l.indexOf(':'); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter((h) => h && h[0]);
  L.hget = (hs, name) => { const n = name.toLowerCase(); const h = hs.find((x) => x[0].toLowerCase() === n); return h ? h[1] : undefined; };
  L.fullMatch = (re, s) => { try { return new RegExp('^(?:' + re + ')$').test(s); } catch (e) { return null; } };
  L.partialMatch = (re, s) => { try { return new RegExp(re).test(s); } catch (e) { return false; } };

  // --- HTTPRoute matching (13.3.3) ---
  L.matchPath = (m, path) => {
    const type = m.type || 'PathPrefix', v = m.value || '/';
    if (type === 'Exact') {
      if (path === v) return { ok: true, why: `${path} equals ${v}: Exact compares the whole path` };
      let why = `${path} ≠ ${v}`;
      if (path.replace(/\/+$/, '') === v.replace(/\/+$/, '')) why += ': Exact compares the whole path, so the trailing slash makes it a different path';
      else if (path.toLowerCase() === v.toLowerCase()) why += ': paths are case-sensitive';
      return { ok: false, why };
    }
    if (type === 'PathPrefix') {
      const ve = L.splitPath(v), pe = L.splitPath(path);
      const ok = ve.every((e, i) => pe[i] === e);
      if (ok) return { ok: true, why: ve.length ? `${path} starts with the path element${ve.length > 1 ? 's' : ''} ${'/' + ve.join('/')}` : 'PathPrefix / has no elements, so every path matches' };
      const i = ve.findIndex((e, k) => pe[k] !== e);
      const naive = path.startsWith(v.replace(/\/+$/, ''));
      let why;
      if (pe[i] !== undefined) why = `${path} ≠ ${v.replace(/\/+$/, '')}/…: PathPrefix is element-wise, "${pe[i]}" is not "${ve[i]}"`;
      else why = `${path} is shorter than ${v}`;
      if (naive) why += ' (a plain string startsWith would have matched: that is the trap)';
      return { ok: false, why };
    }
    // RegularExpression
    const r = L.fullMatch(v, path);
    if (r === null) return { ok: false, why: `${v} is not a valid regular expression` };
    if (r) return { ok: true, why: `${path} fully matches /${v}/` };
    return { ok: false, why: `${path} does not fully match /${v}/` + (L.partialMatch(v, path) ? ' (part of it matches, but the expression must cover the whole path)' : '') };
  };
  L.matchValue = (type, expected, actual, what) => {
    if (actual === undefined) return { ok: false, why: `the request has no ${what}` };
    if ((type || 'Exact') === 'Exact') {
      if (actual === expected) return { ok: true, why: `${what} is ${q(actual)}, equal to ${q(expected)}` };
      return { ok: false, why: `${what} is ${q(actual)}, not ${q(expected)}` + (actual.toLowerCase() === expected.toLowerCase() ? ' (Exact is case-sensitive for values)' : '') };
    }
    const r = L.fullMatch(expected, actual);
    if (r === null) return { ok: false, why: `${expected} is not a valid regular expression` };
    if (r) return { ok: true, why: `${q(actual)} fully matches /${expected}/` };
    return { ok: false, why: `${q(actual)} does not fully match /${expected}/` + (L.partialMatch(expected, actual) ? ' (a partial match is not enough)' : '') };
  };
  // One entry of rule.matches: every condition must hold (logical AND).
  L.matchEntry = (entry, req) => {
    const conds = [];
    if (entry.path) {
      const r = L.matchPath(entry.path, req.path);
      conds.push({ kind: 'path', label: `path ${entry.path.type || 'PathPrefix'} ${entry.path.value}`, ok: r.ok, why: r.why });
    }
    if (entry.method) {
      const ok = String(req.method).toUpperCase() === entry.method;
      conds.push({ kind: 'method', label: `method ${entry.method}`, ok, why: ok ? `the request method is ${req.method}` : `the request method is ${req.method}, not ${entry.method}` });
    }
    (entry.headers || []).forEach((h) => {
      const r = L.matchValue(h.type, h.value, L.hget(req.headers, h.name), `header ${q(h.name)}`);
      conds.push({ kind: 'header', label: `header ${h.name} ${h.type} ${q(h.value)}`, ok: r.ok, why: r.why });
    });
    (entry.queryParams || []).forEach((p) => {
      const f = (req.query || []).find((kv) => kv[0] === p.name);
      const r = L.matchValue(p.type, p.value, f ? f[1] : undefined, `query parameter ${q(p.name)}`);
      conds.push({ kind: 'query', label: `query ${p.name} ${p.type} ${q(p.value)}`, ok: r.ok, why: r.why });
    });
    return { ok: conds.every((c) => c.ok), conds, implicit: conds.length === 0 };
  };
  // Precedence key of one match entry (higher wins, compared left to right):
  // [path tier, PathPrefix length, has method, #headers, #query params]
  // tiers: 4 Exact, 3 PathPrefix (not "/"), 2 RegularExpression, 1 no path / PathPrefix "/".
  L.rank = (entry) => {
    let tier = 1, len = 0;
    const p = entry.path;
    if (p) {
      const t = p.type || 'PathPrefix';
      if (t === 'Exact') tier = 4;
      else if (t === 'PathPrefix') { const v = (p.value || '/').replace(/\/+$/, ''); if (v) { tier = 3; len = v.length; } } else tier = 2;
    }
    return [tier, len, entry.method ? 1 : 0, (entry.headers || []).length, (entry.queryParams || []).length];
  };
  L.cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
  L.STEPS = ['path match type', 'longest PathPrefix', 'method match', 'number of header matches', 'number of query parameter matches', 'rule order'];
  const TIER = { 4: 'Exact', 3: 'PathPrefix', 2: 'RegularExpression', 1: 'no specific path (catch-all)' };
  L.explainStep = (step, w, o) => {
    switch (step) {
      case 0: return `${TIER[w[0]]} outranks ${TIER[o[0]]} (Exact > PathPrefix > RegularExpression > catch-all)`;
      case 1: return `the longer PathPrefix wins (${w[1]} characters vs ${o[1]})`;
      case 2: return 'one rule has a method condition and the other has none';
      case 3: return `more header conditions win (${w[3]} vs ${o[3]})`;
      case 4: return `more query-parameter conditions win (${w[4]} vs ${o[4]})`;
      default: return 'everything else is tied, so the rule listed first wins';
    }
  };
  L.hostMatch = (hostnames, host) => {
    if (!hostnames || !hostnames.length) return true;
    const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
    return hostnames.some((n) => { n = n.toLowerCase(); return n.startsWith('*.') ? h.endsWith(n.slice(1)) && h.length > n.length - 1 : h === n; });
  };
  L.route = (preset, req) => {
    const hostOk = L.hostMatch(preset.hostnames, req.host);
    const rules = preset.rules.map((rule, index) => {
      const implicit = !(rule.matches && rule.matches.length);
      const entries = (implicit ? [{}] : rule.matches).map((entry) => ({ entry, res: L.matchEntry(entry, req), rank: L.rank(entry) }));
      let best = null;
      entries.filter((e) => e.res.ok).forEach((e) => { if (!best || L.cmp(e.rank, best.rank) > 0) best = e; });
      return { index, rule, entries, matched: !!best, best, implicit };
    });
    const full = (c) => c.best.rank.concat(-c.index);
    const cands = hostOk ? rules.filter((r) => r.matched).sort((a, b) => L.cmp(full(b), full(a))) : [];
    const winner = cands[0] || null;
    let step = -1, stepText = '';
    if (cands.length > 1) {
      const a = full(cands[0]), b = full(cands[1]);
      step = a.findIndex((x, i) => x !== b[i]);
      if (step < 0) step = 5;
      stepText = L.explainStep(step > 4 ? 5 : step, a, b);
    }
    return { hostOk, rules, winner: winner ? winner.index : -1, backend: winner ? winner.rule.backend : null, cands: cands.map((c) => c.index), step, stepText };
  };

  // --- weights (13.3.2) ---
  L.weightShares = (ws) => {
    const eff = ws.map((w) => (w === undefined || w === null ? 1 : w)); // omitted weight counts as 1
    const sum = eff.reduce((a, b) => a + b, 0);
    return { eff, sum, shares: eff.map((w) => (sum ? w / sum : 0)) };
  };
  L.rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  L.pick = (eff, rnd) => {
    const sum = eff.reduce((a, b) => a + b, 0);
    if (!sum) return -1;
    let r = rnd() * sum;
    for (let i = 0; i < eff.length; i++) { r -= eff[i]; if (r < 0) return i; }
    return eff.length - 1;
  };
  L.sendBatch = (ws, n, rnd = Math.random) => {
    const { eff } = L.weightShares(ws);
    const picks = [];
    for (let i = 0; i < n; i++) picks.push(L.pick(eff, rnd));
    return picks;
  };

  // --- filters (13.3.4) ---
  // headers: [[name, value]] -> [{name, value, st: same|add|chg|rm, old?}]. Order: set, add, remove.
  L.headerMod = (headers, cfg) => {
    const out = headers.map(([name, value]) => ({ name, value, st: 'same' }));
    const find = (n) => out.find((h) => h.name.toLowerCase() === n.toLowerCase() && h.st !== 'rm');
    const change = (h, value) => { if (h.old === undefined) h.old = h.value; h.value = value; if (h.st !== 'add') h.st = 'chg'; };
    (cfg.set || []).forEach(({ name, value }) => { const h = find(name); if (h) { if (h.value !== value) change(h, value); } else out.push({ name, value, st: 'add' }); });
    (cfg.add || []).forEach(({ name, value }) => { const h = find(name); if (h) change(h, h.value + ', ' + value); else out.push({ name, value, st: 'add' }); });
    (cfg.remove || []).forEach((name) => { const h = find(name); if (h) h.st = 'rm'; });
    return out;
  };
  L.rewritePath = (path, match, rw) => {
    if (rw.type === 'ReplaceFullPath') return rw.value;
    const mv = ((match && match.value) || '/').replace(/\/+$/, '');
    const rest = path.slice(mv.length);
    const out = rw.value.replace(/\/+$/, '') + rest;
    return out === '' ? '/' : out;
  };
  L.redirectLocation = (cfg, req) => {
    const sch = cfg.scheme || 'http';
    const defPort = sch === 'https' ? 443 : 80;
    const hm = String(req.host).match(/^(.*?)(?::(\d+))?$/);
    const hostname = cfg.hostname || hm[1];
    const port = cfg.port ? cfg.port : (hm[2] ? +hm[2] : 0);
    const t = L.parseTarget(req.target);
    const path = cfg.path ? L.rewritePath(t.path, cfg.match, cfg.path) : t.path;
    return `${sch}://${hostname}${port && port !== defPort ? ':' + port : ''}${path}${t.qs ? '?' + t.qs : ''}`;
  };
  const STATUS_TEXT = { 200: 'OK', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect' };
  // input: {host, target, headers:[[n,v]], respHeaders:[[n,v]]}
  L.runFilter = (f, input) => {
    const t = L.parseTarget(input.target);
    const full = (path) => path + (t.qs ? '?' + t.qs : '');
    const req = { method: 'GET', pathFull: full(t.path), host: input.host, headers: input.headers.map(([name, value]) => ({ name, value, st: 'same' })), pathSt: 'same', hostSt: 'same' };
    const out = { notes: [], ruleHit: true, matchWhy: '', toBackend: null, mirror: null, redirect: null, backendName: 'kiada-stable' };
    if (f.match) { const r = L.matchPath(f.match, t.path); out.ruleHit = r.ok; out.matchWhy = r.why; }
    const respIn = input.respHeaders.map(([name, value]) => ({ name, value, st: 'same' }));
    out.reply = { status: 200, text: 'OK', headers: respIn };
    out.toClient = { status: 200, text: 'OK', headers: respIn.map((h) => ({ ...h })) };
    if (!out.ruleHit) { out.toBackend = req; return out; } // falls through to the catch-all rule: nothing is modified
    switch (f.kind) {
      case 'reqhdr':
        out.toBackend = { ...req, headers: L.headerMod(input.headers, f.cfg) };
        break;
      case 'resphdr':
        out.toBackend = req;
        out.toClient.headers = L.headerMod(input.respHeaders, f.cfg);
        break;
      case 'rewrite': {
        const b = { ...req };
        if (f.cfg.hostname) { b.host = f.cfg.hostname; b.hostSt = f.cfg.hostname === input.host ? 'same' : 'chg'; b.hostOld = input.host; }
        if (f.cfg.path) {
          const np = L.rewritePath(t.path, f.match, f.cfg.path);
          b.pathFull = full(np); b.pathSt = np === t.path ? 'same' : 'chg'; b.pathOld = full(t.path);
        }
        out.toBackend = b;
        break;
      }
      case 'redirect': {
        const code = f.cfg.statusCode || 302;
        out.redirect = { status: code, text: STATUS_TEXT[code] || '', location: L.redirectLocation(f.cfg, { host: input.host, target: input.target }) };
        out.toBackend = null;
        out.toClient = { status: code, text: out.redirect.text, headers: [{ name: 'Location', value: out.redirect.location, st: 'add' }, { name: 'Content-Length', value: '0', st: 'add' }] };
        break;
      }
      case 'mirror':
        out.toBackend = req;
        out.mirror = { name: f.cfg.backend, req: { ...req, headers: req.headers.map((h) => ({ ...h })) }, reply: { status: 200, text: 'OK' } };
        break;
      default: out.toBackend = req;
    }
    return out;
  };

  // --- cross-namespace permissions (13.6) ---
  L.xns = (s) => {
    const listener = s.kind === 'HTTPRoute' ? { name: 'http', port: 80, protocol: 'HTTP' } : { name: 'tcp', port: 200, protocol: 'TCP' };
    const apiVersion = s.kind === 'HTTPRoute' ? 'v1' : 'v1alpha2';
    const allowed = s.from === 'All' || (s.from === 'Selector' && !!s.labeled);
    const accepted = allowed
      ? { ok: true, reason: 'Accepted', message: 'Route was valid' }
      : { ok: false, reason: 'NotAllowedByListeners', message: `kind gateway.networking.k8s.io/${apiVersion}/${s.kind} is not allowed; hostnames matched parent hostname "", but namespace "kiada" is not allowed by the parent` };
    const cross = s.backend === 'cross';
    const grantOk = cross ? !!(s.grant && s.grantKind === s.kind) : true;
    const refs = grantOk
      ? { ok: true, reason: 'ResolvedRefs', message: 'All references resolved' }
      : { ok: false, reason: 'RefNotPermitted', message: 'backendRef some-service/service-namespace not accessible to a route in namespace "kiada" (missing a ReferenceGrant?)' };
    const fixes = [];
    if (!allowed) {
      if (s.from === 'Same') fixes.push(`Listener ${listener.name} only accepts routes from gateway-namespace itself: set allowedRoutes.namespaces.from to All or Selector, or move the route there.`);
      else fixes.push('The namespace lacks the label the selector asks for: kubectl label ns kiada part-of=kiada');
    }
    if (!grantOk) {
      if (!s.grant) fixes.push('Create a ReferenceGrant in service-namespace (next to the Service) that allows ' + s.kind + 's in kiada to reference Service some-service.');
      else fixes.push(`The grant's from.kind is ${s.grantKind}, but the route is a ${s.kind}: change it to ${s.kind} (or add a second from entry).`);
    }
    return { listener, apiVersion, accepted, refs, allowed, grantOk, cross, fixes, flows: allowed && grantOk };
  };
  L.xnsYaml = (s, r) => {
    const wrap = (t) => t.replace(/(.{1,76})(\s|$)/g, '$1\n').trimEnd().split('\n').map((l, i) => (i ? '        ' : '') + l).join('\n');
    const cond = (type, c) => [`    - type: ${type}`, `      status: "${c.ok ? 'True' : 'False'}"`, `      reason: ${c.reason}`, `      message: ${wrap(c.message)}`].join('\n');
    return ['status:', '  parents:', '  - parentRef:', '      name: shared', '      namespace: gateway-namespace', '    controllerName: istio.io/gateway-controller', '    conditions:', cond('Accepted', r.accepted), cond('ResolvedRefs', r.refs)].join('\n');
  };

  // =====================================================================================
  //  UI helpers shared by the labs
  // =====================================================================================
  const head = (tag, title, sub) => `<div class="w-head"><span class="w-tag">${tag}</span><b>${title}</b><span class="w-sub">${sub}</span></div>`;
  const seg = (name, opts, cur, label) => `<div class="seg" role="group" aria-label="${esc(label)}" data-seg="${name}">${opts.map(([v, t]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}" class="${v === cur ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>`;
  const setSeg = (root, name, val) => { const g = $(`[data-seg="${name}"]`, root); $$('button', g).forEach((x) => { const on = x.dataset.v === val; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); }); };
  const bindSeg = (root, name, cb) => { const g = $(`[data-seg="${name}"]`, root); $$('button', g).forEach((b) => b.addEventListener('click', () => { setSeg(root, name, b.dataset.v); cb(b.dataset.v); })); };
  const yamlLines = (text, re) => text.split('\n').map((l) => `<span class="wl${re && re.test(l) ? ' on' : ''}">${hlY(l) || ' '}</span>`).join('');
  const fileTail = (name, from) => { const lines = (window.FILES && window.FILES[name] || '').split('\n'); const i = lines.findIndex((l) => from.test(l)); return (i < 0 ? lines : lines.slice(i)).join('\n'); };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // =====================================================================================
  //  1. weight-splitter (13.3.2)
  // =====================================================================================
  function weightSplitter(el) {
    const names = ['kiada-stable', 'kiada-new'];
    let w = [9, 1], omit = false, counts = [0, 0], lost = 0, total = 0, token = 0, busy = false;
    el.innerHTML = `
      ${head('lab', 'Weight splitter', 'One rule, two backends: how do weights turn into traffic?')}
      <div class="ws-top">
        <div class="ws-ctl">
          ${names.map((n, i) => `<div class="ws-row" data-i="${i}">
            <div class="ws-name"><i class="ws-dot b${i}"></i><code>${n}</code><span class="ws-exp"></span></div>
            <div class="ws-inputs"><input type="range" class="ws-r" min="0" max="100" step="1" aria-label="Weight of ${n}"><input type="number" class="ws-n" min="0" max="100" step="1" inputmode="numeric" aria-label="Weight of ${n} (number)"></div>
          </div>`).join('')}
          <label class="w-check"><input type="checkbox" class="ws-omit"> omit the <code>weight</code> fields</label>
        </div>
        <pre class="w-code ws-yaml" aria-label="backendRefs preview"></pre>
      </div>
      <svg class="ws-svg" viewBox="0 0 420 150" role="img" aria-label="The gateway sends requests to kiada-stable and kiada-new">
        <rect class="n-gtw" x="8" y="45" width="100" height="62" rx="10"/>
        <text class="lbl-b t-gtw" x="58" y="73" text-anchor="middle">Gateway</text>
        <text class="lbl-xs" x="58" y="91" text-anchor="middle">HTTPRoute rule</text>
        <path class="edge-dim ws-e e0" d="M108 70 L200 38"/>
        <path class="edge-dim ws-e e1" d="M108 82 L200 112"/>
        <text class="lbl-xs lbl-mono ws-wl0" x="146" y="44" text-anchor="middle"></text>
        <text class="lbl-xs lbl-mono ws-wl1" x="146" y="118" text-anchor="middle"></text>
        <g class="ws-b b0"><rect class="n-svc" x="200" y="10" width="212" height="56" rx="10"/><text class="lbl-b t-svc" x="214" y="33">kiada-stable</text><text class="lbl-xs lbl-mono ws-c0" x="214" y="53">0 requests</text></g>
        <g class="ws-b b1"><rect class="n-svc" x="200" y="84" width="212" height="56" rx="10"/><text class="lbl-b t-svc" x="214" y="107">kiada-new</text><text class="lbl-xs lbl-mono ws-c1" x="214" y="127">0 requests</text></g>
        <g class="ws-pk"></g>
      </svg>
      <div class="w-row ws-btns"><span class="w-lbl">send</span>
        <button type="button" class="w-btn" data-n="10">10 requests</button><button type="button" class="w-btn" data-n="100">100</button><button type="button" class="w-btn" data-n="1000">1000</button>
        <button type="button" class="w-btn ghost ws-reset">reset counters</button></div>
      <div class="ws-bars"></div>
      <div class="verdict ws-note" aria-live="polite"></div>`;
    const rs = $$('.ws-r', el), ns = $$('.ws-n', el), omitBox = $('.ws-omit', el);
    const effW = () => (omit ? [undefined, undefined] : w);
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(+v)));
    const btns = () => $$('.ws-btns .w-btn[data-n]', el);
    const setBtns = () => btns().forEach((b) => (b.disabled = busy));

    function reset() { token++; busy = false; counts = [0, 0]; lost = 0; total = 0; setBtns(); renderBars(); }
    function renderCfg() {
      const sh = L.weightShares(effW());
      rs.forEach((r, i) => { r.value = w[i]; r.disabled = omit; });
      ns.forEach((n, i) => { if (document.activeElement !== n) n.value = w[i]; n.disabled = omit; });
      $$('.ws-exp', el).forEach((s, i) => (s.textContent = `expected ${fmtPct(sh.shares[i])}`));
      const yaml = names.map((n, i) => `- name: ${n}\n  port: 80${omit ? '' : `\n  weight: ${w[i]}${sh.sum ? `   # ${w[i]}/${sh.sum} = ${fmtPct(sh.shares[i])}` : ''}`}`).join('\n');
      $('.ws-yaml', el).innerHTML = yamlLines('backendRefs:\n' + yaml);
      [0, 1].forEach((i) => {
        const e = $(`.ws-e.e${i}`, el); e.style.strokeWidth = (1.5 + 7 * sh.shares[i]).toFixed(1);
        e.style.stroke = sh.shares[i] > 0 ? 'var(--accent)' : '';
        $(`.ws-wl${i}`, el).textContent = omit ? 'weight 1' : `weight ${w[i]}`;
      });
      let note;
      if (omit) note = 'No <code>weight</code> fields: every backend counts as weight 1, so the split is even (50/50 here, a third each with three backends).';
      else if (sh.sum === 0) note = 'Both weights are 0, so the sum is 0 and <b>no backend can receive traffic</b>. A weight of 0 means "never"; with nothing left to choose from, the gateway cannot forward the request (what the client gets is up to the implementation).';
      else if (w[0] === 0 || w[1] === 0) note = `Weight 0 means never: <code>${names[w[0] === 0 ? 0 : 1]}</code> stays in the manifest but receives nothing, so every request goes to <code>${names[w[0] === 0 ? 1 : 0]}</code>.`;
      else note = `Share = weight ÷ sum of weights: ${w[0]}/${sh.sum} and ${w[1]}/${sh.sum}. Weights are relative, not percentages (90 and 10 behave exactly like 9 and 1). Each request is drawn independently, so the observed split only approaches the expected one as you send more requests.`;
      $('.ws-note', el).innerHTML = note;
    }
    function renderBars() {
      const sh = L.weightShares(effW());
      const row = (i) => {
        const p = total ? counts[i] / total : 0;
        return `<div class="ws-bar"><div class="ws-bar-h"><code>${names[i]}</code><span>observed <b>${counts[i]}</b>${total ? ` · ${fmtPct(p)}` : ''}</span><span class="ws-ex">expected ${fmtPct(sh.shares[i])}</span></div>
          <div class="ws-track" role="img" aria-label="${names[i]}: ${counts[i]} of ${total} requests, expected ${fmtPct(sh.shares[i])}"><div class="ws-fill b${i}" style="width:${(p * 100).toFixed(1)}%"></div><i class="ws-tick" style="left:${(sh.shares[i] * 100).toFixed(1)}%"></i></div></div>`;
      };
      $('.ws-bars', el).innerHTML = row(0) + row(1) + (lost ? `<div class="ws-lost">${lost} request${lost > 1 ? 's' : ''} had no backend to go to</div>` : '') + (total ? `<div class="ws-total">${total} request${total > 1 ? 's' : ''} sent in total · the tick on each bar marks the expected share</div>` : '<div class="ws-total">no requests yet: press a send button</div>');
      [0, 1].forEach((i) => { $(`.ws-c${i}`, el).textContent = `${counts[i]} request${counts[i] === 1 ? '' : 's'}`; });
    }
    function fly(i) {
      const g = $('.ws-pk', el); if (!g) return;
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('r', 5); c.setAttribute('class', i < 0 ? 'packet-bad' : 'packet');
      g.appendChild(c);
      const x0 = 108, y0 = 76, x1 = i < 0 ? 150 : 200, y1 = i < 0 ? 76 : (i === 0 ? 38 : 112);
      const t0 = performance.now(), d = 420;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / d);
        c.setAttribute('cx', x0 + (x1 - x0) * k); c.setAttribute('cy', y0 + (y1 - y0) * k);
        if (k < 1) requestAnimationFrame(step);
        else { c.remove(); if (i >= 0) { const b = $(`.ws-b.b${i}`, el); if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 180); } } }
      };
      requestAnimationFrame(step);
    }
    function run(n) {
      if (busy) return;
      const picks = L.sendBatch(effW(), n);
      busy = true; setBtns();
      const my = ++token;
      const dur = reduceMotion() ? 0 : n <= 10 ? 1500 : n <= 100 ? 1900 : 2400;
      const vis = Math.min(n, 18);
      let applied = 0, flown = 0;
      const apply = (upto) => { while (applied < upto) { const p = picks[applied++]; if (p < 0) lost++; else counts[p]++; total++; } renderBars(); };
      if (!dur) { apply(n); busy = false; setBtns(); return; }
      const t0 = performance.now();
      const tick = (t) => {
        if (my !== token) return;
        const k = Math.min(1, (t - t0) / dur);
        while (flown < vis && flown / vis <= k) { fly(picks[Math.floor(flown * n / vis)]); flown++; }
        apply(Math.round(k * n));
        if (k < 1) requestAnimationFrame(tick); else { apply(n); busy = false; setBtns(); }
      };
      requestAnimationFrame(tick);
    }
    rs.forEach((r, i) => r.addEventListener('input', () => { w[i] = clamp(r.value); reset(); renderCfg(); }));
    ns.forEach((n, i) => n.addEventListener('input', () => { if (n.value === '' || isNaN(+n.value)) return; w[i] = clamp(n.value); reset(); renderCfg(); }));
    ns.forEach((n, i) => n.addEventListener('blur', () => { n.value = w[i]; }));
    omitBox.addEventListener('change', () => { omit = omitBox.checked; reset(); renderCfg(); });
    btns().forEach((b) => b.addEventListener('click', () => run(+b.dataset.n)));
    $('.ws-reset', el).addEventListener('click', reset);
    renderCfg(); renderBars();
  }

  // =====================================================================================
  //  2. httproute-lab (13.3.3)
  // =====================================================================================
  const K = 'kiada.example.com';
  const HR_PRESETS = [
    { id: 'method', label: 'method', file: 'httproute.kiada.method.yaml', hostnames: [K],
      rules: [{ matches: [{ method: 'POST' }], backend: 'kiada-new' }, { backend: 'kiada-stable' }],
      samples: [['GET /', 'GET', '/', ''], ['POST /', 'POST', '/', ''], ['PUT /', 'PUT', '/', ''], ['DELETE /quiz', 'DELETE', '/quiz', '']] },
    { id: 'header', label: 'header', file: 'httproute.kiada.header.yaml', hostnames: [K],
      rules: [{ matches: [{ headers: [{ type: 'Exact', name: 'Release', value: 'new' }] }], backend: 'kiada-new' }, { backend: 'kiada-stable' }],
      samples: [['no header', 'GET', '/', ''], ['Release: new', 'GET', '/', 'Release: new'], ['release: new (lower-case name)', 'GET', '/', 'release: new'], ['Release: New', 'GET', '/', 'Release: New'], ['Release: newer', 'GET', '/', 'Release: newer']] },
    { id: 'header-regex', label: 'header regex', file: 'httproute.kiada.header-regex.yaml', hostnames: [K],
      rules: [{ matches: [{ headers: [{ type: 'RegularExpression', name: 'Release', value: 'new.*' }] }], backend: 'kiada-new' }, { backend: 'kiada-stable' }],
      samples: [['Release: new', 'GET', '/', 'Release: new'], ['Release: newer', 'GET', '/', 'Release: newer'], ['Release: new-v2', 'GET', '/', 'Release: new-v2'], ['Release: renew', 'GET', '/', 'Release: renew'], ['Release: stable', 'GET', '/', 'Release: stable']] },
    { id: 'api', label: 'path (api)', file: 'httproute.api.yaml', hostnames: ['api.example.com'],
      rules: [{ matches: [{ path: { type: 'Exact', value: '/quote' } }], backend: 'quote' }, { matches: [{ path: { type: 'PathPrefix', value: '/quiz' } }], backend: 'quiz' }],
      samples: [['/quote', 'GET', '/quote', ''], ['/quote/', 'GET', '/quote/', ''], ['/quote/1', 'GET', '/quote/1', ''], ['/quiz', 'GET', '/quiz', ''], ['/quiz/abc', 'GET', '/quiz/abc', ''], ['/quizzes', 'GET', '/quizzes', ''], ['/', 'GET', '/', '']] },
    { id: 'static-regex', label: 'path regex', file: 'httproute.kiada.static-regex.yaml', hostnames: [K],
      rules: [{ matches: [{ path: { type: 'RegularExpression', value: '.*\\.(css|js|png|ico)' } }], backend: 'kiada-new' }, { backend: 'kiada-stable' }],
      samples: [['/style.css', 'GET', '/style.css', ''], ['/img/logo.png', 'GET', '/img/logo.png', ''], ['/app.js?v=3', 'GET', '/app.js?v=3', ''], ['/css', 'GET', '/css', ''], ['/index.html', 'GET', '/index.html', '']] },
    { id: 'query', label: 'query', file: 'httproute.kiada.query.yaml', hostnames: [K],
      rules: [{ matches: [{ queryParams: [{ type: 'Exact', name: 'release', value: 'new' }] }], backend: 'kiada-new' }, { backend: 'kiada-stable' }],
      samples: [['/', 'GET', '/', ''], ['/?release=new', 'GET', '/?release=new', ''], ['/?release=old', 'GET', '/?release=old', ''], ['/?Release=new', 'GET', '/?Release=new', ''], ['/?x=1&release=new', 'GET', '/?x=1&release=new', '']] },
    { id: 'combined', label: 'combined', file: 'httproute.kiada.combined.yaml', hostnames: [K],
      rules: [{ matches: [{ path: { type: 'PathPrefix', value: '/some-prefix' }, headers: [{ type: 'Exact', name: 'Release', value: 'new' }, { type: 'RegularExpression', name: 'Cookie', value: '.*specialCookie.*' }] }], backend: 'kiada-new' }, { backend: 'kiada-stable' }],
      samples: [['all three conditions', 'GET', '/some-prefix/page', 'Release: new\nCookie: session=1; specialCookie=yes'], ['no cookie', 'GET', '/some-prefix/page', 'Release: new'], ['no Release header', 'GET', '/some-prefix', 'Cookie: specialCookie=yes'], ['wrong prefix', 'GET', '/other', 'Release: new\nCookie: specialCookie=yes']] },
  ];

  function httprouteLab(el) {
    let pi = 0;
    const P = HR_PRESETS;
    el.innerHTML = `
      ${head('lab', 'HTTPRoute lab', 'Pick a route, build a request, see which rule wins and why')}
      <div class="w-presets hl-presets" role="group" aria-label="Preset HTTPRoute">${P.map((p, i) => `<button type="button" data-i="${i}" aria-pressed="false">${esc(p.label)}</button>`).join('')}</div>
      <div class="hl-file"><code class="hl-fname"></code><span class="hl-hosts"></span></div>
      <div class="hl-req">
        <label class="w-field hl-m"><span class="w-lbl">method</span><select class="hl-method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => `<option>${m}</option>`).join('')}</select></label>
        <label class="w-field hl-h"><span class="w-lbl">Host</span><input class="hl-host" spellcheck="false" autocomplete="off"></label>
        <label class="w-field hl-p"><span class="w-lbl">path + query</span><input class="hl-path" spellcheck="false" autocomplete="off"></label>
        <label class="w-field hl-hd"><span class="w-lbl">headers (Name: value, one per line)</span><textarea class="hl-headers" rows="3" spellcheck="false"></textarea></label>
      </div>
      <div class="w-presets hl-samples" role="group" aria-label="Quick-fill requests"></div>
      <div class="verdict hl-verdict" aria-live="polite"></div>
      <div class="hl-rules"></div>
      <details class="hl-prec"><summary>How the gateway breaks ties between matching rules</summary>
        <ol><li><b>Exact</b> path match</li><li><b>PathPrefix</b> with the most characters</li><li><b>RegularExpression</b> path (implementation-specific; here it ranks above a bare <code>/</code> catch-all)</li><li>a <b>method</b> match</li><li>the most <b>header</b> conditions</li><li>the most <b>query parameter</b> conditions</li><li>otherwise the rule listed <b>first</b></li></ol>
        <p>Matches inside one <code>matches:</code> list are ORed, conditions inside one entry are ANDed. Header names ignore case; values, paths and query names do not. A rule with no <code>matches</code> behaves like <code>PathPrefix /</code>.</p></details>`;
    const method = $('.hl-method', el), host = $('.hl-host', el), path = $('.hl-path', el), hdrs = $('.hl-headers', el);
    const verdict = $('.hl-verdict', el), rulesEl = $('.hl-rules', el);
    const pbtns = $$('.hl-presets button', el);

    function setSample(s) { method.value = s[1]; path.value = s[2]; hdrs.value = s[3]; evaluate(); }
    function selectPreset(i) {
      pi = i;
      const p = P[i];
      pbtns.forEach((b, k) => { b.classList.toggle('active', k === i); b.setAttribute('aria-pressed', String(k === i)); });
      $('.hl-fname', el).textContent = p.file;
      $('.hl-hosts', el).textContent = 'hostnames: ' + p.hostnames.join(', ') + ' · backend port 80';
      host.value = p.hostnames[0];
      $('.hl-samples', el).innerHTML = '<span class="w-lbl">try</span>' + p.samples.map((s, k) => `<button type="button" data-s="${k}">${esc(s[0])}</button>`).join('');
      $$('.hl-samples button', el).forEach((b) => b.addEventListener('click', () => setSample(p.samples[+b.dataset.s])));
      setSample(p.samples[0]);
    }
    function evaluate() {
      const p = P[pi];
      const t = L.parseTarget(path.value);
      const req = { method: method.value, host: host.value.trim(), path: t.path, query: t.query, headers: L.parseHeaders(hdrs.value) };
      const r = L.route(p, req);
      const reqLine = `${req.method} ${t.path}${t.qs ? '?' + t.qs : ''}`;
      if (!r.hostOk) verdict.innerHTML = `<b>✗ 404</b> <code>${esc(req.host || '(empty)')}</code> matches none of this route's hostnames (${p.hostnames.map((h) => `<code>${esc(h)}</code>`).join(', ')}), so the gateway never looks at the rules.`;
      else if (r.winner < 0) verdict.innerHTML = `<b>✗ 404</b> <code>${esc(reqLine)}</code> matched no rule.${r.rules.some((x) => x.implicit) ? '' : ' This route has no catch-all rule (a rule without <code>matches</code>), so unmatched requests get a 404.'}`;
      else {
        verdict.innerHTML = `<b>✓ → ${esc(r.backend)}</b> <code>${esc(reqLine)}</code> is routed by rule ${r.winner + 1}. ` + (r.cands.length > 1
          ? `<span class="hl-step">Rules ${r.cands.map((c) => c + 1).join(' and ')} ${r.cands.length === 2 ? 'both' : 'all'} match. Rule ${r.winner + 1} wins at tie-break ${r.step + 1} of 6, <i>${L.STEPS[r.step]}</i>: ${esc(r.stepText)}.</span>`
          : '<span class="hl-step">It is the only rule that matches, so there is no tie to break.</span>');
      }
      rulesEl.innerHTML = r.rules.map((ru) => {
        const state = !r.hostOk ? 'no dim' : ru.index === r.winner ? 'win' : ru.matched ? 'out' : 'no';
        const badge = ru.index === r.winner ? '✓ winner' : ru.matched && r.hostOk ? 'matches, outranked' : '✗ no match';
        const entries = ru.entries.map((e, k) => `<div class="hl-entry">${ru.entries.length > 1 ? `<div class="hl-or">${k ? 'OR ' : ''}match entry ${k + 1}</div>` : ''}${
          e.res.implicit ? '<div class="hl-cond ok"><span class="hl-mark">✓</span><code>no <b>matches</b> given</code><span class="hl-why">a catch-all: behaves like PathPrefix / and accepts every request that reached this route</span></div>'
            : e.res.conds.map((c) => `<div class="hl-cond ${c.ok ? 'ok' : 'bad'}"><span class="hl-mark">${c.ok ? '✓' : '✗'}</span><code>${esc(c.label)}</code><span class="hl-why">${esc(c.why)}</span></div>`).join('')
        }</div>`).join('');
        return `<div class="hl-rule ${state}"><div class="hl-rh"><span class="hl-ri">rule ${ru.index + 1}</span><span class="hl-to">→ <code>${esc(ru.rule.backend)}</code></span><span class="hl-badge">${badge}</span></div>${entries}</div>`;
      }).join('');
    }
    pbtns.forEach((b) => b.addEventListener('click', () => selectPreset(+b.dataset.i)));
    [method, host, path, hdrs].forEach((x) => x.addEventListener('input', evaluate));
    selectPreset(0);
  }

  // =====================================================================================
  //  3. filter-lab (13.3.4)
  // =====================================================================================
  const FILTERS = [
    { id: 'reqhdr', label: 'RequestHeaderModifier', short: 'request headers', kind: 'reqhdr', file: 'httproute.kiada.request-headers.yaml', path: '/',
      cfg: { add: [{ name: 'added-by-gateway', value: 'This header was added via requestHeaderModifier' }], set: [{ name: 'set-by-gateway', value: 'This header was set via requestHeaderModifier' }], remove: ['RemoveMe'] },
      samples: [['/', '/']],
      note: '<code>add</code> appends to an existing header (comma-separated) or creates it, <code>set</code> overwrites or creates it, <code>remove</code> deletes by name. Header names are case-insensitive.' },
    { id: 'resphdr', label: 'ResponseHeaderModifier', short: 'response headers', kind: 'resphdr', file: 'httproute.kiada.response-headers.yaml', path: '/',
      cfg: { add: [{ name: 'added-by-gateway', value: 'added via responseHeaderModifier' }], set: [{ name: 'server', value: 'kiada-gateway' }], remove: ['x-envoy-upstream-service-time'] },
      samples: [['/', '/']],
      note: 'Same <code>add</code>/<code>set</code>/<code>remove</code> fields, but under <code>responseHeaderModifier</code> and applied to the answer on its way back. The backend never sees the change. Edit the backend reply below to try other headers.' },
    { id: 'rwfull', label: 'URLRewrite · ReplaceFullPath', short: 'rewrite full path', kind: 'rewrite', file: 'httproute.kiada.rewrite-full.yaml', path: '/foo/bar',
      match: { type: 'PathPrefix', value: '/foo' }, cfg: { hostname: 'newhost.kiada.example.com', path: { type: 'ReplaceFullPath', value: '/new/path' } },
      samples: [['/foo', '/foo'], ['/foo/bar', '/foo/bar'], ['/foobar', '/foobar'], ['/bar', '/bar']],
      note: 'Whatever sits under <code>/foo</code> becomes exactly <code>/new/path</code>, and the Host header is replaced. <b>Edge case from the book:</b> <code>/foobar</code> does not match the PathPrefix <code>/foo</code> (prefixes are matched per path element), so it falls through to the catch-all rule and reaches the backend unchanged.' },
    { id: 'rwprefix', label: 'URLRewrite · ReplacePrefixMatch', short: 'rewrite prefix', kind: 'rewrite', file: 'httproute.kiada.rewrite-prefix.yaml', path: '/foo/bar',
      match: { type: 'PathPrefix', value: '/foo' }, cfg: { path: { type: 'ReplacePrefixMatch', value: '/new/path' } },
      samples: [['/foo', '/foo'], ['/foo/bar', '/foo/bar'], ['/foo/bar?x=1', '/foo/bar?x=1'], ['/foobar', '/foobar']],
      note: 'Only the matched prefix is swapped: <code>/foo</code> becomes <code>/new/path</code>, <code>/foo/bar</code> becomes <code>/new/path/bar</code>. The query string is kept and the Host is untouched. <code>/foobar</code> does not match the prefix, so nothing is rewritten.' },
    { id: 'redirect', label: 'RequestRedirect', short: 'redirect', kind: 'redirect', file: 'httproute.kiada.redirect.yaml', path: '/quiz',
      cfg: { scheme: 'https', port: 443, statusCode: 301 }, samples: [['/', '/'], ['/quiz?x=1', '/quiz?x=1']],
      note: 'The gateway answers by itself with a redirect: the rule has no <code>backendRefs</code> and no backend is called. Empty fields (hostname, path) are taken from the request; port 443 is the default for https, so it is left out of the Location. Without <code>statusCode</code> the gateway sends 302 Found.' },
    { id: 'mirror', label: 'RequestMirror', short: 'mirror', kind: 'mirror', file: 'httproute.kiada.mirror.yaml', path: '/',
      cfg: { backend: 'kiada-new' }, samples: [['/', '/'], ['/quiz', '/quiz']],
      note: 'The client only ever sees the reply from <code>kiada-stable</code>. <code>kiada-new</code> gets a copy of the request (check its log with <code>kubectl logs kiada-new -c kiada</code>), but its reply is thrown away.' },
  ];
  const FL_REQ = 'User-Agent: curl/8.0.1\nRemoveMe: please\nadded-by-gateway: from-client\nset-by-gateway: from-client';
  const FL_RESP = 'Content-Type: text/plain\nserver: istio-envoy\nx-envoy-upstream-service-time: 3\nadded-by-gateway: from-backend';

  function filterLab(el) {
    let fi = 0;
    el.innerHTML = `
      ${head('lab', 'Filter lab', 'What does the backend receive, and what does the client get back?')}
      <div class="w-presets fl-pick" role="group" aria-label="Filter">${FILTERS.map((f, i) => `<button type="button" data-i="${i}" aria-pressed="false">${esc(f.label)}</button>`).join('')}</div>
      <div class="fl-yaml"><div class="fl-yaml-h"><code class="fl-file"></code><span>spec.rules</span></div><pre class="w-code fl-code"></pre></div>
      <div class="fl-in">
        <label class="w-field"><span class="w-lbl">Host</span><input class="fl-host" value="kiada.example.com" spellcheck="false" autocomplete="off"></label>
        <label class="w-field"><span class="w-lbl">GET path + query</span><input class="fl-path" spellcheck="false" autocomplete="off"></label>
        <label class="w-field fl-wide"><span class="w-lbl">client request headers</span><textarea class="fl-hdr" rows="4" spellcheck="false">${esc(FL_REQ)}</textarea></label>
        <label class="w-field fl-wide fl-resp-f"><span class="w-lbl">backend reply headers</span><textarea class="fl-rhdr" rows="4" spellcheck="false">${esc(FL_RESP)}</textarea></label>
      </div>
      <div class="w-presets fl-samples" role="group" aria-label="Quick-fill paths"></div>
      <div class="fl-out" aria-live="polite"></div>
      <div class="verdict fl-note"></div>`;
    const host = $('.fl-host', el), path = $('.fl-path', el), hdr = $('.fl-hdr', el), rhdr = $('.fl-rhdr', el);
    const btns = $$('.fl-pick button', el);

    const pane = (title, sub, lines, tone) => `<div class="fl-pane ${tone || ''}"><div class="fl-ph"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div><div class="fl-lines">${lines.map((l) => `<div class="fl-line st-${l.st || 'same'}"><i class="fl-sig">${{ add: '+', chg: '~', rm: '−' }[l.st] || ' '}</i><span class="fl-t">${esc(l.t)}</span>${l.note ? `<em>${esc(l.note)}</em>` : ''}</div>`).join('') || '<div class="fl-none">nothing</div>'}</div></div>`;
    const reqLines = (m, diff) => {
      const ls = [{ t: `${m.method} ${m.pathFull} HTTP/1.1`, st: diff ? m.pathSt : 'same', note: diff && m.pathSt === 'chg' ? `was ${m.pathOld}` : '' },
        { t: `Host: ${m.host}`, st: diff ? m.hostSt : 'same', note: diff && m.hostSt === 'chg' ? `was ${m.hostOld}` : '' }];
      m.headers.forEach((h) => ls.push({ t: `${h.name}: ${h.value}`, st: diff ? h.st : 'same', note: diff && h.old !== undefined ? `was: ${h.old}` : '' }));
      return ls;
    };
    const respLines = (r, diff) => [{ t: `HTTP/1.1 ${r.status} ${r.text}`, st: diff && r.status !== 200 ? 'add' : 'same' }].concat(r.headers.map((h) => ({ t: `${h.name}: ${h.value}`, st: diff ? h.st : 'same', note: diff && h.old !== undefined ? `was: ${h.old}` : '' })));
    const arrow = (label, extra) => `<div class="fl-mid"><span class="fl-gw">Gateway</span><span class="fl-fn">${esc(label)}</span><span class="fl-ar" aria-hidden="true"></span>${extra || ''}</div>`;

    function pick(i) {
      fi = i;
      const f = FILTERS[i];
      btns.forEach((b, k) => { b.classList.toggle('active', k === i); b.setAttribute('aria-pressed', String(k === i)); });
      $('.fl-file', el).textContent = f.file;
      $('.fl-code', el).innerHTML = yamlLines(fileTail(f.file, /^\s*rules:/), /type: (RequestHeaderModifier|ResponseHeaderModifier|URLRewrite|RequestRedirect|RequestMirror)|^\s*filters:/);
      $('.fl-resp-f', el).hidden = f.kind !== 'resphdr';
      path.value = f.path;
      $('.fl-samples', el).innerHTML = f.samples.length > 1 ? '<span class="w-lbl">try</span>' + f.samples.map((s, k) => `<button type="button" data-s="${k}">${esc(s[0])}</button>`).join('') : '';
      $$('.fl-samples button', el).forEach((b) => b.addEventListener('click', () => { path.value = f.samples[+b.dataset.s][1]; render(); }));
      render();
    }
    function render() {
      const f = FILTERS[fi];
      const input = { host: host.value.trim() || 'kiada.example.com', target: path.value || '/', headers: L.parseHeaders(hdr.value), respHeaders: L.parseHeaders(rhdr.value) };
      const r = L.runFilter(f, input);
      const t = L.parseTarget(input.target);
      const clientReq = { method: 'GET', pathFull: t.path + (t.qs ? '?' + t.qs : ''), host: input.host, headers: input.headers.map(([name, value]) => ({ name, value })) };
      let rows = '';
      // request direction
      let right;
      if (f.kind === 'redirect' && r.ruleHit) right = pane('backend receives', '', [], 'dim') + '<div class="fl-cap">The gateway never routes this request: no backend is called.</div>';
      else if (f.kind === 'mirror') right = pane('kiada-stable receives', 'original: its reply goes to the client', reqLines(r.toBackend, false), 'ok') + pane('kiada-new receives a copy', 'its reply is discarded', reqLines(r.mirror.req, false), 'mirror');
      else right = pane(`${r.backendName} receives`, r.ruleHit ? '' : 'catch-all rule: no filter applied', reqLines(r.toBackend, r.ruleHit), r.ruleHit ? 'ok' : '');
      rows += `<div class="fl-flow">${pane('client sends', '', reqLines(clientReq, false), '')}${arrow(f.short)}<div class="fl-col">${right}</div></div>`;
      // response direction
      let leftR, rightR;
      if (f.kind === 'redirect' && r.ruleHit) { leftR = pane('backend replies', '', [], 'dim'); rightR = pane('client receives', 'generated by the gateway', respLines(r.toClient, true), 'ok'); }
      else if (f.kind === 'mirror') { leftR = pane('kiada-stable replies', '', respLines(r.reply, false), '') + pane('kiada-new replies', 'dropped', respLines(r.reply, false), 'dim'); rightR = pane('client receives', 'only the kiada-stable reply', respLines(r.toClient, false), 'ok'); }
      else { leftR = pane('backend replies', '', respLines(r.reply, false), ''); rightR = pane('client receives', '', respLines(r.toClient, r.ruleHit && f.kind === 'resphdr'), 'ok'); }
      rows += `<div class="fl-flow resp"><div class="fl-col">${leftR}</div>${arrow(f.kind === 'resphdr' ? f.short : 'reply passes back')}<div class="fl-col">${rightR}</div></div>`;
      $('.fl-out', el).innerHTML = rows;
      let note = f.note;
      if (f.match) {
        const ok = r.ruleHit;
        note = `<span class="${ok ? 'fl-hit' : 'fl-miss'}"><b>${ok ? '✓' : '✗'}</b> rule 1: <code>${esc(input.target.split('?')[0] || '/')}</code> vs PathPrefix <code>${esc(f.match.value)}</code>: ${esc(r.matchWhy)}.${ok ? '' : ' The catch-all rule 2 serves it, untouched.'}</span><br>` + note;
      }
      $('.fl-note', el).innerHTML = note;
    }
    btns.forEach((b) => b.addEventListener('click', () => pick(+b.dataset.i)));
    [host, path, hdr, rhdr].forEach((x) => x.addEventListener('input', render));
    pick(0);
  }

  // =====================================================================================
  //  4. tls-modes (13.4)
  // =====================================================================================
  function tlsModes(el) {
    let mode = 'Terminate';
    el.innerHTML = `
      ${head('toggle', 'TLS: terminate or pass through', 'Who holds the certificate decides what the gateway can do')}
      <div class="w-row">${seg('mode', [['Terminate', 'Terminate'], ['Passthrough', 'Passthrough']], mode, 'TLS mode')}</div>
      <div class="tm-stage"></div>
      <div class="tm-grid"><div class="tm-facts"></div><div class="tm-view"></div></div>
      <div class="tm-yaml"></div>`;
    const info = {
      Terminate: [
        ['Gateway sees the SNI hostname', '<span class="ok">✓</span> <code>kiada.example.com</code> (sent in the clear in the ClientHello)'],
        ['Gateway sees method, path, headers, cookies', '<span class="ok">✓</span> yes: it decrypted the request'],
        ['Listener <code>protocol</code>', '<code>HTTPS</code>'],
        ['<code>tls.mode</code>', '<code>Terminate</code> (the default)'],
        ['<code>certificateRefs</code> on the gateway', '<span class="ok">required</span>: Secret <code>kiada-tls</code>'],
        ['Route kind', '<code>HTTPRoute</code> (stable <code>v1</code>)'],
        ['Backend port', '<code>80</code> → plain HTTP to the kiada container (8080)'],
        ['Routing you can do', 'everything HTTPRoute offers: path, method, header and query matching, filters, weights, mirroring'],
      ],
      Passthrough: [
        ['Gateway sees the SNI hostname', '<span class="ok">✓</span> <code>kiada.example.com</code> (sent in the clear in the ClientHello)'],
        ['Gateway sees method, path, headers, cookies', '<span class="bad">✗</span> no: it only forwards encrypted bytes'],
        ['Listener <code>protocol</code>', '<code>TLS</code>'],
        ['<code>tls.mode</code>', '<code>Passthrough</code>'],
        ['<code>certificateRefs</code> on the gateway', '<span class="muted">not needed</span>: the certificate lives in the pod'],
        ['Route kind', '<code>TLSRoute</code> (<code>v1alpha2</code>, experimental channel)'],
        ['Backend port', '<code>443</code> → the envoy sidecar (8443), which terminates TLS'],
        ['Routing you can do', 'only by hostname (SNI) plus weights between backends: nothing inside the encrypted stream is visible'],
      ],
    };
    const gwView = {
      Terminate: 'GET /quiz HTTP/1.1\nHost: kiada.example.com\nCookie: session=7f3a91\nUser-Agent: curl/8.0.1',
      Passthrough: 'TLS ClientHello\n  server_name (SNI): kiada.example.com\n17 03 03 00 5a 8f e1 c2 9d 41 07 b6 3e …\n(encrypted application data: opaque to the gateway)',
    };
    function svgFor(m) {
      const T = m === 'Terminate';
      let s = `<svg viewBox="0 0 760 275" class="tm-svg" role="img" aria-label="${T ? 'The client connects over TLS; the gateway terminates it and forwards plain HTTP to the kiada container' : 'The client connects over TLS; the gateway forwards the encrypted stream to the envoy sidecar, which terminates TLS and talks plain HTTP to the kiada container over loopback'}">`;
      s += '<rect class="n-zone" x="410" y="30" width="340" height="222" rx="16"/><text class="lbl-sm t-pod" x="426" y="50">kiada pod</text>';
      s += '<rect class="n-client" x="10" y="95" width="100" height="60" rx="10"/><text class="lbl-b t-client" x="60" y="122" text-anchor="middle">client</text><text class="lbl-xs" x="60" y="140" text-anchor="middle">curl / browser</text>';
      s += '<rect class="n-proxy" x="200" y="65" width="150" height="120" rx="14"/><text class="lbl-b t-gtw" x="275" y="90" text-anchor="middle">Gateway</text><text class="lbl-xs" x="275" y="106" text-anchor="middle">Envoy proxy</text>';
      s += `<rect class="badge" x="225" y="116" width="100" height="18" rx="9"/><text class="badge-t" x="275" y="129" text-anchor="middle">${T ? 'HTTPS :443' : 'TLS :443'}</text>`;
      s += `<rect class="badge" x="212" y="146" width="126" height="18" rx="9"/><text class="badge-t" x="275" y="159" text-anchor="middle">${T ? 'TLS ends here' : 'TLS untouched'}</text>`;
      if (T) s += '<rect class="n-secret" x="205" y="205" width="140" height="40" rx="8"/><text class="lbl-sm t-secret" x="275" y="222" text-anchor="middle">Secret kiada-tls</text><text class="lbl-xs" x="275" y="237" text-anchor="middle">certificateRefs</text><path class="edge-dim" d="M275 205 V 186"/>';
      else s += '<text class="lbl-xs t-muted" x="275" y="212" text-anchor="middle">no certificate here:</text><text class="lbl-xs t-muted" x="275" y="228" text-anchor="middle">nothing to decrypt with</text>';
      s += `<g opacity="${T ? '.38' : '1'}"><rect class="n-proxy" x="430" y="90" width="130" height="70" rx="12"/><text class="lbl-b t-proxy" x="495" y="115" text-anchor="middle">envoy sidecar</text><text class="lbl-mono lbl-xs" x="495" y="136" text-anchor="middle">${T ? 'idle: bypassed' : ':8443 (TLS)'}</text></g>`;
      s += '<rect class="n-pod" x="615" y="90" width="120" height="70" rx="12"/><text class="lbl-b t-pod" x="675" y="115" text-anchor="middle">kiada</text><text class="lbl-mono lbl-xs" x="675" y="136" text-anchor="middle">:8080 plain HTTP</text>';
      if (!T) s += '<rect class="badge" x="440" y="64" width="110" height="18" rx="9"/><text class="badge-t" x="495" y="77" text-anchor="middle">TLS ends here</text><rect class="n-secret" x="430" y="196" width="130" height="40" rx="8"/><text class="lbl-sm t-secret" x="495" y="213" text-anchor="middle">cert in the pod</text><text class="lbl-xs" x="495" y="228" text-anchor="middle">the app owns TLS</text><path class="edge-dim" d="M495 196 V 162"/>';
      // hops
      s += '<path class="flow-tls" d="M110 125 L 198 125" marker-end="url(#arrow-tls)"/><text class="lbl-xs t-secret" x="154" y="113" text-anchor="middle">encrypted</text>';
      if (T) {
        s += '<path class="flow" d="M350 150 C 395 150, 400 215, 450 215 L 675 215 L 675 162" marker-end="url(#arrow-accent)"/><text class="lbl-xs t-proxy" x="562" y="206" text-anchor="middle">port 80 → 8080 · plain HTTP</text>';
      } else {
        s += '<path class="flow-tls" d="M350 125 L 428 125" marker-end="url(#arrow-tls)"/><text class="lbl-xs t-secret" x="389" y="113" text-anchor="middle">443 → 8443</text><text class="lbl-xs t-secret" x="389" y="143" text-anchor="middle">encrypted</text>';
        s += '<path class="flow" d="M560 125 L 613 125" marker-end="url(#arrow-accent)"/><text class="lbl-xs t-proxy" x="587" y="113" text-anchor="middle">loopback</text><text class="lbl-xs t-proxy" x="587" y="143" text-anchor="middle">plain</text>';
      }
      // packets
      s += '<circle class="packet-tls" r="5"><animateMotion dur="1.4s" repeatCount="indefinite" path="M110 125 L 198 125"/></circle>';
      if (T) s += '<circle class="packet" r="5"><animateMotion dur="2.6s" repeatCount="indefinite" path="M350 150 C 395 150, 400 215, 450 215 L 675 215 L 675 162"/></circle>';
      else s += '<circle class="packet-tls" r="5"><animateMotion dur="1.4s" repeatCount="indefinite" begin="-.7s" path="M350 125 L 428 125"/></circle><circle class="packet" r="5"><animateMotion dur="1.2s" repeatCount="indefinite" path="M560 125 L 613 125"/></circle>';
      s += '<path class="flow-tls" d="M12 262 L 42 262"/><text class="lbl-xs" x="48" y="266">encrypted</text><path class="flow" d="M120 262 L 150 262"/><text class="lbl-xs" x="156" y="266">plaintext</text>';
      return s + '</svg>';
    }
    function render() {
      $('.tm-stage', el).innerHTML = svgFor(mode);
      $('.tm-facts', el).innerHTML = `<table class="tm-table"><caption class="w-lbl">in ${mode} mode</caption><tbody>${info[mode].map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`).join('')}</tbody></table>`;
      $('.tm-view', el).innerHTML = `<div class="w-lbl">what the gateway can read</div><pre class="w-code tm-pre">${hlHTTP(gwView[mode])}</pre>`;
      const gw = mode === 'Terminate' ? 'gtw.kiada.tls-terminate.yaml' : 'gtw.kiada.tls-passthrough.yaml';
      const rt = mode === 'Terminate' ? 'httproute.kiada.yaml' : 'tlsroute.kiada.yaml';
      $('.tm-yaml', el).innerHTML = `<div class="tm-ycol"><div class="fl-yaml-h"><code>${gw}</code><span>spec.listeners</span></div><pre class="w-code">${yamlLines(fileTail(gw, /^\s*listeners:/), /protocol:|mode:|certificateRefs|name: kiada-tls/)}</pre></div>
        <div class="tm-ycol"><div class="fl-yaml-h"><code>${rt}</code><span>the route</span></div><pre class="w-code">${yamlLines(window.FILES && window.FILES[rt] || '', /kind: (HTTPRoute|TLSRoute)|port: \d+|hostnames/)}</pre></div>`;
    }
    bindSeg(el, 'mode', (v) => { mode = v; render(); });
    render();
  }

  // =====================================================================================
  //  5. xns-lab (13.6)
  // =====================================================================================
  function xnsLab(el) {
    const id = ++uid;
    const S = { kind: 'TCPRoute', from: 'Selector', labeled: false, backend: 'cross', grant: false, grantKind: 'HTTPRoute' };
    el.innerHTML = `
      ${head('lab', 'Cross-namespace lab', 'Who may attach to the shared gateway, and who may reach a Service in another namespace?')}
      <div class="xl-ctl">
        <div class="w-field"><span class="w-lbl">route kind (in namespace kiada)</span>${seg('kind', [['HTTPRoute', 'HTTPRoute'], ['TCPRoute', 'TCPRoute']], S.kind, 'Route kind')}</div>
        <div class="w-field"><span class="w-lbl">listener <code>allowedRoutes.namespaces.from</code></span>${seg('from', [['Same', 'Same'], ['All', 'All'], ['Selector', 'Selector']], S.from, 'allowedRoutes from')}</div>
        <div class="w-field"><span class="w-lbl">namespace kiada</span><label class="w-check"><input type="checkbox" class="xl-label"> has label <code>part-of=kiada</code></label></div>
        <div class="w-field"><span class="w-lbl">backend Service lives in</span>${seg('backend', [['same', 'kiada (same)'], ['cross', 'service-namespace']], S.backend, 'Backend namespace')}</div>
        <div class="w-field xl-grant"><span class="w-lbl">ReferenceGrant in service-namespace</span>
          <label class="w-check"><input type="checkbox" class="xl-grant-on"> exists</label>
          <label class="xl-gk"><span>from.kind</span><select class="xl-grant-kind" aria-label="from.kind in the ReferenceGrant"><option>HTTPRoute</option><option>TCPRoute</option></select></label></div>
      </div>
      <div class="w-presets xl-presets" role="group" aria-label="Scenarios"><span class="w-lbl">scenario</span>
        <button type="button" data-p="a">13.6.1: TCPRoute, Selector, no label</button><button type="button" data-p="b">13.6.2: HTTPRoute, grant missing</button><button type="button" data-p="c">wrong kind in the grant</button><button type="button" data-p="d">all green</button></div>
      <div class="xl-stage"></div>
      <div class="xl-bottom"><pre class="w-code xl-yaml" aria-label="Route status conditions"></pre><div class="xl-res" aria-live="polite"></div></div>`;
    const stage = $('.xl-stage', el);
    const syncCtl = () => {
      setSeg(el, 'kind', S.kind); setSeg(el, 'from', S.from); setSeg(el, 'backend', S.backend);
      $('.xl-label', el).checked = S.labeled; $('.xl-label', el).disabled = S.from !== 'Selector';
      $('.xl-grant-on', el).checked = S.grant; $('.xl-grant-kind', el).value = S.grantKind;
      const cross = S.backend === 'cross';
      $('.xl-grant-on', el).disabled = !cross; $('.xl-grant-kind', el).disabled = !cross || !S.grant;
      $('.xl-grant', el).classList.toggle('off', !cross);
    };
    function draw(r) {
      const cls = (ok) => (ok ? 'flow-ok' : 'flow-bad'), mk = (ok) => (ok ? `url(#xns-ok-${id})` : 'url(#arrow-bad)');
      const tx = (ok) => (ok ? 't-ok' : 't-bad');
      let s = `<svg viewBox="0 0 760 290" class="xl-svg" role="img" aria-label="Namespaces gateway-namespace, kiada and service-namespace with the route's attachment ${r.allowed ? 'allowed' : 'refused'} and its backend reference ${r.grantOk ? 'allowed' : 'refused'}">
        <defs><marker id="xns-ok-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="mk-ok" d="M0 0 L10 5 L0 10 z"/></marker></defs>
        <rect class="n-ns" x="8" y="12" width="222" height="266" rx="14"/><text class="lbl-xs lbl-mono t-muted" x="20" y="30">ns: gateway-namespace</text>
        <rect class="n-ns" x="270" y="12" width="222" height="266" rx="14"/><text class="lbl-xs lbl-mono t-muted" x="282" y="30">ns: kiada</text>`;
      s += S.labeled ? '<rect class="badge" x="352" y="17" width="104" height="16" rx="8"/><text class="badge-t" x="404" y="29" text-anchor="middle">part-of=kiada</text>' : '<text class="lbl-xs t-muted" x="352" y="30">no part-of label</text>';
      s += `<rect class="n-ns" x="530" y="12" width="222" height="266" rx="14" ${r.cross ? '' : 'opacity=".35"'}/><text class="lbl-xs lbl-mono t-muted" x="542" y="30" ${r.cross ? '' : 'opacity=".5"'}>ns: service-namespace</text>`;
      // gateway
      s += `<rect class="n-gtw" x="22" y="66" width="194" height="128" rx="12"/><text class="lbl-b t-gtw" x="36" y="90">Gateway shared</text>
        <text class="lbl-xs lbl-mono" x="36" y="110">listener ${r.listener.name} :${r.listener.port}</text><text class="lbl-xs lbl-mono" x="36" y="126">protocol: ${r.listener.protocol}</text>
        <text class="lbl-xs lbl-mono" x="36" y="148">allowedRoutes.namespaces</text><text class="lbl-xs lbl-mono ${S.from === 'Same' ? 't-default' : 't-pod'}" x="36" y="164">from: ${S.from}</text>${S.from === 'Selector' ? '<text class="lbl-xs lbl-mono t-muted" x="36" y="180">part-of: kiada</text>' : ''}`;
      // route
      s += `<rect class="n-route" x="284" y="66" width="194" height="92" rx="12"/><text class="lbl-b t-route" x="298" y="90">${S.kind}</text><text class="lbl-xs lbl-mono t-muted" x="298" y="106">${r.apiVersion}</text>
        <text class="lbl-xs lbl-mono ${tx(r.accepted.ok)}" x="298" y="128">${r.accepted.ok ? '✓' : '✗'} Accepted: ${r.accepted.ok ? 'True' : 'False'}</text><text class="lbl-xs lbl-mono ${tx(r.refs.ok)}" x="298" y="146">${r.refs.ok ? '✓' : '✗'} ResolvedRefs: ${r.refs.ok ? 'True' : 'False'}</text>`;
      s += `<path class="${cls(r.accepted.ok)}" d="M284 100 L 220 100" marker-end="${mk(r.accepted.ok)}"/><text class="lbl-xs ${tx(r.accepted.ok)}" x="252" y="92" text-anchor="middle">parentRef</text>`;
      // backend
      const svcName = S.kind === 'HTTPRoute' ? 'kiada' : 'test', svcPort = S.kind === 'HTTPRoute' ? 80 : 2000;
      if (!r.cross) {
        s += `<rect class="n-svc" x="284" y="204" width="194" height="56" rx="10"/><text class="lbl-b t-svc" x="298" y="228">Service ${svcName}</text><text class="lbl-xs lbl-mono" x="298" y="246">port ${svcPort}</text>
          <path class="${cls(true)}" d="M381 158 L 381 202" marker-end="${mk(true)}"/><text class="lbl-xs t-ok" x="390" y="184">backendRef</text>`;
        s += '<text class="lbl-xs t-muted" x="641" y="150" text-anchor="middle" opacity=".6">unused here</text>';
      } else {
        s += `<rect class="n-svc" x="544" y="204" width="194" height="56" rx="10"/><text class="lbl-b t-svc" x="558" y="228">Service some-service</text><text class="lbl-xs lbl-mono" x="558" y="246">port 80</text>
          <path class="${cls(r.grantOk)}" d="M478 140 C 512 140, 512 232, 542 232" marker-end="${mk(r.grantOk)}"/><text class="lbl-xs ${tx(r.grantOk)}" x="494" y="196" text-anchor="middle" transform="rotate(-90 494 196)">backendRef</text>`;
        if (S.grant) {
          s += `<rect class="n-api" x="544" y="66" width="194" height="108" rx="10"/><text class="lbl-b t-api" x="558" y="90">ReferenceGrant</text><text class="lbl-xs lbl-mono" x="558" y="110">from: ${S.grantKind}</text><text class="lbl-xs lbl-mono" x="558" y="126">      in namespace kiada</text><text class="lbl-xs lbl-mono" x="558" y="142">to: Service some-service</text>${S.grantKind !== S.kind ? `<text class="lbl-xs lbl-mono t-bad" x="558" y="162">✗ route is a ${S.kind}</text>` : '<text class="lbl-xs lbl-mono t-ok" x="558" y="162">✓ covers this route</text>'}<path class="edge-dim" d="M641 174 V 202"/>`;
        } else s += '<rect class="n-zone" x="544" y="76" width="194" height="88" rx="10"/><text class="lbl-xs t-muted" x="641" y="118" text-anchor="middle">no ReferenceGrant</text><text class="lbl-xs t-muted" x="641" y="136" text-anchor="middle">in this namespace</text>';
      }
      stage.innerHTML = s + '</svg>';
    }
    function render() {
      syncCtl();
      const r = L.xns(S);
      draw(r);
      $('.xl-yaml', el).innerHTML = yamlLines(L.xnsYaml(S, r), /reason: (NotAllowedByListeners|RefNotPermitted)|status: "False"/);
      const res = $('.xl-res', el);
      res.className = 'xl-res ' + (r.flows ? 'good' : 'bad');
      const lines = [];
      lines.push(`<div class="xl-line ${r.accepted.ok ? 'ok' : 'bad'}"><b>${r.accepted.ok ? '✓' : '✗'} Accepted</b> ${r.accepted.ok ? `the ${esc(r.listener.name)} listener lets namespace kiada attach` : `the ${esc(r.listener.name)} listener refuses routes from kiada (${S.from === 'Same' ? 'Same = only gateway-namespace' : 'the selector needs part-of=kiada'})`}.</div>`);
      lines.push(`<div class="xl-line ${r.refs.ok ? 'ok' : 'bad'}"><b>${r.refs.ok ? '✓' : '✗'} ResolvedRefs</b> ${r.cross ? (r.grantOk ? 'a ReferenceGrant covers this route kind and Service' : 'no matching ReferenceGrant') : 'the backend is in the route\'s own namespace: no grant needed'}.</div>`);
      if (r.fixes.length) lines.push(`<div class="xl-fix"><b>Fix:</b> ${r.fixes.map((f) => esc(f)).join(' ')}</div>`);
      else lines.push('<div class="xl-fix good"><b>All set:</b> the route is attached and its backend resolves, so traffic flows.</div>');
      if (!r.accepted.ok) lines.push('<div class="xl-aside">The message starts with <i>kind … is not allowed</i> even when the real blocker is the namespace: it is how Istio phrases a listener that refuses the route.</div>');
      res.innerHTML = lines.join('');
    }
    bindSeg(el, 'kind', (v) => { S.kind = v; if (S.grantKind !== v && !S.grant) S.grantKind = v; render(); });
    bindSeg(el, 'from', (v) => { S.from = v; render(); });
    bindSeg(el, 'backend', (v) => { S.backend = v; render(); });
    $('.xl-label', el).addEventListener('change', (e) => { S.labeled = e.target.checked; render(); });
    $('.xl-grant-on', el).addEventListener('change', (e) => { S.grant = e.target.checked; render(); });
    $('.xl-grant-kind', el).addEventListener('change', (e) => { S.grantKind = e.target.value; render(); });
    const PRESETS = {
      a: { kind: 'TCPRoute', from: 'Selector', labeled: false, backend: 'same', grant: false, grantKind: 'TCPRoute' },
      b: { kind: 'HTTPRoute', from: 'All', labeled: false, backend: 'cross', grant: false, grantKind: 'HTTPRoute' },
      c: { kind: 'TCPRoute', from: 'All', labeled: false, backend: 'cross', grant: true, grantKind: 'HTTPRoute' },
      d: { kind: 'TCPRoute', from: 'Selector', labeled: true, backend: 'cross', grant: true, grantKind: 'TCPRoute' },
    };
    $$('.xl-presets button', el).forEach((b) => b.addEventListener('click', () => { Object.assign(S, PRESETS[b.dataset.p]); render(); }));
    render();
  }

  // =====================================================================================
  //  6. support-matrix (13.1.2)
  // =====================================================================================
  const SM_CHANNEL = { std: 'standard', exp: 'experimental' };
  const SM_LEVEL = { core: 'core', ext: 'extended', impl: 'implementation-specific' };
  const SM_CELL = {
    'std/core': 'Stable and every implementation must support it. Safe to move between providers.',
    'std/ext': 'Stable shape and portable behaviour, but an implementation may skip it. Check its conformance report.',
    'std/impl': 'Stable field, but what it means is up to the implementation (for example the regex dialect).',
    'exp/core': 'Experimental CRDs, yet mandatory when implemented. Nothing in this chapter lives here.',
    'exp/ext': 'Needs the experimental CRDs, may still change, and an implementation may not support it at all.',
    'exp/impl': 'Experimental and provider-specific: the least portable corner. Nothing in this chapter lives here.',
  };
  const SM_WHAT = {
    'std/core': 'Portable. Every conformant implementation behaves the same, so you can switch providers without touching this part of your manifests.',
    'std/ext': 'Portable if supported. The behaviour is defined, so another implementation that supports it acts the same way, but not all of them do. Check before you switch.',
    'std/impl': 'Not portable. The field exists in the stable API, but its semantics depend on the provider. Read its documentation and expect to rewrite it on a switch.',
    'exp/core': 'Portable but experimental.',
    'exp/ext': 'You must install the experimental channel CRDs, the API may change between releases, and support is optional. Expect work when upgrading or switching.',
    'exp/impl': 'Experimental and non-portable.',
  };
  const SM_FEATURES = [
    { id: 'path', label: 'Path match: Exact / PathPrefix', ch: 'std', lv: 'core', code: 'path:\n  type: PathPrefix\n  value: /quiz', text: 'The two path match types every implementation has to honour, so they are the safe default for path-based routing (13.3.3).' },
    { id: 'hdr', label: 'Header match: Exact', ch: 'std', lv: 'core', code: 'headers:\n- type: Exact\n  name: Release\n  value: new', text: 'Matching a header value exactly works everywhere. Header names are case-insensitive.' },
    { id: 'weight', label: 'Weighted backendRefs', ch: 'std', lv: 'core', code: 'backendRefs:\n- name: kiada-stable\n  weight: 9\n- name: kiada-new\n  weight: 1', text: 'Splitting traffic by weight (13.3.2) is core: canary releases port cleanly between providers.' },
    { id: 'reqhdr', label: 'RequestHeaderModifier', ch: 'std', lv: 'core', code: 'type: RequestHeaderModifier', text: 'Adding, setting and removing request headers is a core filter.' },
    { id: 'redirect', label: 'RequestRedirect', ch: 'std', lv: 'core', code: 'type: RequestRedirect', text: 'Redirecting without calling a backend (for example HTTP to HTTPS) is core.' },
    { id: 'rg', label: 'ReferenceGrant', ch: 'std', lv: 'core', code: 'kind: ReferenceGrant', text: 'The object that permits cross-namespace backend references (13.6.2) is stable and core.' },
    { id: 'method', label: 'Method match', ch: 'std', lv: 'ext', code: 'matches:\n- method: POST', text: 'Routing on the HTTP method is part of the stable API, but implementations are free not to support it.' },
    { id: 'query', label: 'Query parameter match', ch: 'std', lv: 'ext', code: 'queryParams:\n- type: Exact\n  name: release\n  value: new', text: 'Stable and portable where available (13.3.3), yet optional for implementations.' },
    { id: 'resphdr', label: 'ResponseHeaderModifier', ch: 'std', lv: 'ext', code: 'type: ResponseHeaderModifier', text: 'Changing response headers is extended: well defined, not mandatory.' },
    { id: 'rewrite', label: 'URLRewrite', ch: 'std', lv: 'ext', code: 'type: URLRewrite', text: 'Rewriting host and path before the backend sees the request (13.3.4) is extended.' },
    { id: 'mirror', label: 'RequestMirror', ch: 'std', lv: 'ext', code: 'type: RequestMirror', text: 'Copying traffic to a second backend whose reply is dropped is extended.' },
    { id: 'regex', label: 'RegularExpression match', ch: 'std', lv: 'impl', code: 'path:\n  type: RegularExpression\n  value: .*\\.(css|js)', text: 'Regex matching on paths, headers and query values: the field is stable, but the regex syntax depends on the implementation, so check its documentation.' },
    { id: 'extref', label: 'ExtensionRef filter', ch: 'std', lv: 'impl', code: 'type: ExtensionRef\nextensionRef:\n  kind: SomeCustomFilter', text: 'The escape hatch for provider-specific filters (13.3.4). By definition not portable.' },
    { id: 'tlsroute', label: 'TLSRoute', ch: 'exp', lv: 'ext', code: 'kind: TLSRoute  # v1alpha2', text: 'Routing TLS by SNI without decrypting (13.4.2). In the book\'s era only HTTPRoute was in the standard channel.' },
    { id: 'tcproute', label: 'TCPRoute', ch: 'exp', lv: 'ext', code: 'kind: TCPRoute  # v1alpha2', text: 'Plain TCP forwarding (13.5.1). Experimental in the book\'s era.' },
    { id: 'udproute', label: 'UDPRoute', ch: 'exp', lv: 'ext', code: 'kind: UDPRoute  # v1alpha2', text: 'UDP forwarding (13.5.2). Experimental, and the book notes Istio does not implement it.' },
    { id: 'grpcroute', label: 'GRPCRoute', ch: 'exp', lv: 'ext', code: 'kind: GRPCRoute  # v1alpha2', text: 'gRPC-aware routing by service and method (13.5.3). Experimental in the book\'s era, and not handled by Istio at that time.' },
  ];

  function supportMatrix(el) {
    let sel = 'query';
    const cell = (ch, lv) => {
      const key = ch + '/' + lv, fs = SM_FEATURES.filter((f) => f.ch === ch && f.lv === lv);
      return `<div class="sm-cell" data-k="${key}"><div class="sm-ch"><span class="sm-tag ${ch}">${SM_CHANNEL[ch]}</span><span class="sm-tag ${lv}">${SM_LEVEL[lv]}</span></div><p>${esc(SM_CELL[key])}</p>
        <div class="sm-chips">${fs.map((f) => `<button type="button" class="sm-chip" data-id="${f.id}" aria-pressed="false">${esc(f.label)}</button>`).join('') || '<span class="sm-none">none here</span>'}</div></div>`;
    };
    el.innerHTML = `
      ${head('explorer', 'Release channel × support level', 'Where does each feature sit, and what does that mean for portability?')}
      <div class="sm-axes">
        <div class="sm-axis"><b>Release channel</b><span>which CRDs you install</span><p><i>standard</i> holds only stable resources and fields that will not change. <i>experimental</i> adds resources and fields that may still change.</p></div>
        <div class="sm-axis"><b>Support level</b><span>who has to implement it</span><p><i>core</i> must be supported by every implementation. <i>extended</i> is portable but optional. <i>implementation-specific</i> is not portable at all.</p></div>
      </div>
      <div class="sm-grid">${cell('std', 'core')}${cell('std', 'ext')}${cell('std', 'impl')}${cell('exp', 'core')}${cell('exp', 'ext')}${cell('exp', 'impl')}</div>
      <div class="sm-detail" aria-live="polite"></div>
      <p class="sm-era">Classified per the book's era (Gateway API v1.0). Features move over time (a route kind can graduate to the standard channel, an extended feature can become core), so treat this as a snapshot and check the current docs and your implementation's conformance report.</p>`;
    const chips = $$('.sm-chip', el), cells = $$('.sm-cell', el);
    function show(id) {
      sel = id;
      const f = SM_FEATURES.find((x) => x.id === id), key = f.ch + '/' + f.lv;
      chips.forEach((c) => { const on = c.dataset.id === id; c.classList.toggle('active', on); c.setAttribute('aria-pressed', String(on)); });
      cells.forEach((c) => c.classList.toggle('sel', c.dataset.k === key));
      $('.sm-detail', el).innerHTML = `<div class="sm-dh"><b>${esc(f.label)}</b><span class="sm-tag ${f.ch}">${SM_CHANNEL[f.ch]}</span><span class="sm-tag ${f.lv}">${SM_LEVEL[f.lv]}</span></div>
        <p>${esc(f.text)}</p><pre class="w-code sm-code">${yamlLines(f.code)}</pre><p class="sm-port"><b>For portability:</b> ${esc(SM_WHAT[key])}</p>`;
    }
    chips.forEach((c) => c.addEventListener('click', () => show(c.dataset.id)));
    show(sel);
  }

  // =====================================================================================
  window.WIDGETS = {
    init(root = document) {
      const once = (sel, fn) => $$(sel, root).forEach((e) => { if (e.dataset.wready) return; e.dataset.wready = '1'; fn(e); });
      once('.code[data-src]', codeBlock);
      once('pre.snippet', snippet);
      once('.quiz', quiz);
      once('.tabset', tabset);
      once('figure.stepper', stepper);
      once('.widget.weight-splitter', weightSplitter);
      once('.widget.httproute-lab', httprouteLab);
      once('.widget.filter-lab', filterLab);
      once('.widget.tls-modes', tlsModes);
      once('.widget.xns-lab', xnsLab);
      once('.widget.support-matrix', supportMatrix);
      $$('.term:not(.term-ready)', root).forEach((t) => new window.Term(t));
    },
    logic: L,
    presets: { http: HR_PRESETS, filters: FILTERS },
  };
})();
