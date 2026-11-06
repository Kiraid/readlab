// Page widgets: code blocks, quizzes, tabs, steppers, matchers, router playground, LB slider, cluster HUD.
(function () {
  const esc = (s) => window.escHTML(s);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const SVGNS = 'http://www.w3.org/2000/svg';

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
    const lines = window.hlYAML(text).split('\n');
    el.innerHTML = `
      <div class="code-head"><span class="fname">${esc(src)}</span>${kinds ? `<span class="kind">${esc(kinds)}</span>` : ''}
        <span class="code-actions"><button class="cbtn run" title="Run kubectl apply -f ${esc(src)} in the drop-down shell">▶ apply</button><button class="cbtn copy">copy</button></span></div>
      <pre><code>${lines.map((l, i) => `<span class="cl${hl.has(i + 1) ? ' hl' : ''}"><span class="n">${i + 1}</span>${l || ' '}</span>`).join('')}</code></pre>`;
    $('.copy', el).addEventListener('click', (e) => { navigator.clipboard && navigator.clipboard.writeText(text); e.target.textContent = 'copied'; setTimeout(() => (e.target.textContent = 'copy'), 1200); });
    $('.run', el).addEventListener('click', () => window.APP && window.APP.runInDock(`kubectl apply -f ${src}`));
  }
  function snippet(el) {
    const lang = el.dataset.lang;
    const text = el.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    if (lang === 'yaml') el.innerHTML = window.hlYAML(text);
    else if (lang === 'bash' || lang === 'shell' || lang === 'sh') el.innerHTML = esc(text).replace(/^(\$ )/gm, '<span class="y-com">$1</span>');
    else el.textContent = text;
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

  // ---------- path matcher ----------
  function pathMatcher(el) {
    const presets = [
      ['Prefix', '/foo', '/foo/bar'], ['Prefix', '/foo', '/foobar'], ['Prefix', '/foo/', '/foo'], ['Prefix', '/foo', '/FOO'],
      ['Prefix', '/', '/anything/at/all'], ['Exact', '/quote', '/quote'], ['Exact', '/quote', '/quote/'], ['Prefix', '/questions', '/questions/random'],
    ];
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">lab</span><b>Path matcher</b><span class="w-sub">How does an Ingress compare a rule path with the request path?</span></div>
      <div class="w-grid">
        <label>pathType<div class="seg" role="group"><button data-t="Exact">Exact</button><button data-t="Prefix" class="active">Prefix</button></div></label>
        <label>rule path<input class="rp" value="/foo" spellcheck="false"></label>
        <label>request path<input class="qp" value="/foo/bar" spellcheck="false"></label>
      </div>
      <div class="w-presets">${presets.map((p, i) => `<button data-i="${i}">${p[0] === 'Exact' ? '<i>Exact</i> ' : ''}${esc(p[1])} <span>vs</span> ${esc(p[2])}</button>`).join('')}</div>
      <div class="pm-vis"></div>
      <div class="verdict"></div>`;
    let type = 'Prefix';
    const rp = $('.rp', el), qp = $('.qp', el), vis = $('.pm-vis', el), verdict = $('.verdict', el);
    const seg = $$('.seg button', el);
    const setType = (t) => { type = t; seg.forEach((b) => b.classList.toggle('active', b.dataset.t === t)); upd(); };
    seg.forEach((b) => (b.onclick = () => setType(b.dataset.t)));
    $$('.w-presets button', el).forEach((b) => (b.onclick = () => { const p = presets[+b.dataset.i]; rp.value = p[1]; qp.value = p[2]; setType(p[0]); }));
    rp.oninput = qp.oninput = upd;
    function upd() {
      const r = rp.value || '/', q = (qp.value || '/').split(/[?#]/)[0] || '/';
      const ok = SIM.pathScore(type, r, q) >= 0;
      let why;
      if (type === 'Exact') {
        vis.innerHTML = `<div class="pm-row"><span class="pm-l">rule</span><code class="pm-str ${ok ? 'eq' : 'ne'}">${esc(r)}</code></div><div class="pm-row"><span class="pm-l">request</span><code class="pm-str ${ok ? 'eq' : 'ne'}">${esc(q)}</code></div>`;
        why = ok ? 'Character-for-character identical. Exact is happy.' : r.toLowerCase() === q.toLowerCase() ? 'Only the letter case differs, and matching is case-sensitive.' : r.replace(/\/$/, '') === q.replace(/\/$/, '') ? 'Only a trailing slash differs. For Exact, that is a different path.' : 'The strings differ, so Exact says no.';
      } else {
        const re = SIM.splitPath(r), qe = SIM.splitPath(q);
        const n = Math.max(re.length, qe.length, 1);
        let cells = '';
        for (let i = 0; i < n; i++) {
          const a = re[i], b = qe[i];
          const st = a === undefined ? (b === undefined ? 'none' : 'extra') : a === b ? 'eq' : 'ne';
          cells += `<div class="pm-col ${st}"><code>${a === undefined ? '·' : esc(a)}</code><span class="pm-op">${st === 'eq' ? '=' : st === 'ne' ? '≠' : st === 'extra' ? 'free' : ''}</span><code>${b === undefined ? '·' : esc(b)}</code></div>`;
        }
        vis.innerHTML = `<div class="pm-labels"><span>rule</span><span></span><span>request</span></div><div class="pm-cols">${re.length === 0 ? '<div class="pm-col eq root"><code>/</code><span class="pm-op">⊇</span><code>(all)</code></div>' : ''}${cells}</div>`;
        const naive = q.startsWith(r);
        if (re.length === 0) why = 'A rule path of "/" has zero elements, so every request path matches it.';
        else if (ok) why = `All ${re.length} rule element${re.length > 1 ? 's' : ''} line up with the start of the request. Extra request elements are fine.`;
        else if (re.length > qe.length && re.every((x, i) => x === qe[i] || qe[i] === undefined)) why = 'The request has fewer elements than the rule, so it cannot start with it.';
        else why = 'Some element differs. Prefix compares whole path elements (split on "/"), not raw characters.';
        if (naive !== ok) why += ` <span class="naive">A naive string startsWith() would have said <b>${naive ? 'match' : 'no match'}</b>. That is the trap.</span>`;
      }
      verdict.className = 'verdict ' + (ok ? 'yes' : 'no');
      verdict.innerHTML = `<b>${ok ? '✓ match' : '✗ no match'}</b> ${why}`;
    }
    upd();
  }

  // ---------- host matcher ----------
  function hostMatcher(el) {
    const presets = [['kiada.example.com', 'kiada.example.com'], ['kiada.example.com', 'api.example.com'], ['*.example.com', 'api.example.com'], ['*.example.com', 'example.com'], ['*.example.com', 'foo.kiada.example.com'], ['', 'whatever.io']];
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">lab</span><b>Host matcher</b><span class="w-sub">Exact hosts, wildcards, and the missing host field</span></div>
      <div class="w-grid two">
        <label>rule host <small>(blank = no host field)</small><input class="rh" value="*.example.com" spellcheck="false"></label>
        <label>request Host header<input class="qh" value="foo.kiada.example.com" spellcheck="false"></label>
      </div>
      <div class="w-presets">${presets.map((p, i) => `<button data-i="${i}">${esc(p[0] || '(none)')} <span>vs</span> ${esc(p[1])}</button>`).join('')}</div>
      <div class="hm-vis"></div><div class="verdict"></div>`;
    const rh = $('.rh', el), qh = $('.qh', el), vis = $('.hm-vis', el), verdict = $('.verdict', el);
    $$('.w-presets button', el).forEach((b) => (b.onclick = () => { const p = presets[+b.dataset.i]; rh.value = p[0]; qh.value = p[1]; upd(); }));
    rh.oninput = qh.oninput = upd;
    function upd() {
      const r = rh.value.trim().toLowerCase(), q = qh.value.trim().toLowerCase();
      const s = SIM.hostScore(r, q);
      const rl = r ? r.split('.') : [], ql = q.split('.');
      const n = Math.max(rl.length, ql.length);
      let cols = '';
      for (let i = 0; i < n; i++) {
        const a = rl[rl.length - n + i], b = ql[ql.length - n + i];
        let st = a === undefined ? 'none' : b === undefined ? 'ne' : a === '*' ? (i === n - rl.length ? 'wild' : 'ne') : a === b ? 'eq' : 'ne';
        if (!r) st = 'free';
        cols += `<div class="pm-col ${st}"><code>${a === undefined ? '·' : esc(a)}</code><span class="pm-op">${st === 'eq' ? '=' : st === 'wild' ? '∗ 1 label' : st === 'ne' ? '≠' : ''}</span><code>${b === undefined ? '·' : esc(b)}</code></div>`;
      }
      vis.innerHTML = `<div class="pm-labels"><span>rule</span><span></span><span>request</span></div><div class="pm-cols rtl">${cols}</div>`;
      let why;
      if (!r) why = 'No host in the rule means it applies to every Host header. Lowest priority, though.';
      else if (s === 2) why = 'Identical names. An exact host beats any wildcard rule for the same request.';
      else if (s === 1) why = 'The * stands in for exactly one DNS label, and the rest lines up.';
      else if (r.startsWith('*.') && ql.length > rl.length) why = 'Too many labels. The * covers one label only, so the extra subdomain level breaks it.';
      else if (r.startsWith('*.') && ql.length < rl.length) why = 'The * needs a label to stand in for; the bare domain has none.';
      else why = 'Different names, no wildcard to save it.';
      verdict.className = 'verdict ' + (s >= 0 ? 'yes' : 'no');
      verdict.innerHTML = `<b>${s >= 0 ? '✓ match' : '✗ no match'}</b> ${why}`;
    }
    upd();
  }

  // ---------- router playground ----------
  function routerPlayground(el) {
    const presets = [
      ['http', 'kiada.example.com', '/'], ['http', 'api.example.com', '/quote'], ['http', 'api.example.com', '/questions/random'],
      ['http', 'api.example.com', '/quote/'], ['http', 'api.example.com', '/unknown-path'], ['http', 'unknown-host.example.com', '/'],
      ['https', 'kiada.example.com', '/'], ['http', '11.22.33.44', '/'],
    ];
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">playground</span><b>Request router</b><span class="w-sub">Fire a request at the Ingress and follow it to a pod</span></div>
      <div class="rp-src seg"><button data-s="book" class="active">Final kiada Ingress</button><button data-s="live">Your simulated cluster</button></div>
      <form class="rp-bar">
        <select class="rp-scheme"><option>http</option><option>https</option></select><span class="rp-sep">://</span>
        <input class="rp-host" list="rp-hosts" value="api.example.com" spellcheck="false" aria-label="host">
        <datalist id="rp-hosts"><option>kiada.example.com</option><option>api.example.com</option><option>unknown-host.example.com</option><option>11.22.33.44</option></datalist>
        <input class="rp-path" value="/questions/random" spellcheck="false" aria-label="path">
        <button class="rp-send" type="submit">send ▶</button>
      </form>
      <div class="w-presets">${presets.map((p, i) => `<button data-i="${i}">${p[0] === 'https' ? '🔒 ' : ''}${esc(p[1])}${esc(p[2])}</button>`).join('')}</div>
      <div class="rp-stage"></div>
      <div class="rp-result"></div>`;
    let mode = 'book', rr = {};
    const stage = $('.rp-stage', el), result = $('.rp-result', el);
    const scheme = $('.rp-scheme', el), host = $('.rp-host', el), path = $('.rp-path', el);
    $$('.rp-src button', el).forEach((b) => (b.onclick = () => { mode = b.dataset.s; $$('.rp-src button', el).forEach((x) => x.classList.toggle('active', x === b)); draw(); result.innerHTML = ''; }));
    $$('.w-presets button', el).forEach((b) => (b.onclick = () => { const p = presets[+b.dataset.i]; scheme.value = p[0]; host.value = p[1]; path.value = p[2]; send(); }));
    $('.rp-bar', el).addEventListener('submit', (e) => { e.preventDefault(); send(); });
    let layout = null;

    function env() {
      if (mode === 'book') return { ...SIM.bookEnv(), rr };
      return { ...SIM.liveEnv(), rr };
    }
    function rulesOf(e) {
      const out = [];
      e.views.forEach((v) => (v.spec.rules || []).forEach((r) => ((r.http && r.http.paths) || []).forEach((p) => out.push({ view: v, rule: r, p, host: r.host || '*', path: p.path || '/', type: p.pathType, backend: p.backend }))));
      const d = e.views.find((v) => v.spec.defaultBackend);
      if (d) out.push({ view: d, default: true, host: 'no rule matched', path: '', type: '', backend: d.spec.defaultBackend });
      return out;
    }
    function draw() {
      const e = env();
      const rules = rulesOf(e);
      const svcNames = [];
      rules.forEach((r) => { const n = r.backend.service ? r.backend.service.name : r.backend.resource.kind; if (!svcNames.includes(n)) svcNames.push(n); });
      const svcs = svcNames.map((n) => ({ name: n, pods: (SIM.endpoints(n, e) || []) }));
      const W = 760, rowH = 50;
      let y = 24;
      const svcBoxes = svcs.map((s) => { const h = 34 + Math.max(1, s.pods.length) * 24; const b = { ...s, x: 560, y, w: 190, h }; y += h + 12; return b; });
      const rulesH = rules.length * rowH;
      const H = Math.max(y + 10, rulesH + 40, 230);
      const r0 = (H - rulesH) / 2;
      const ruleBoxes = rules.map((r, i) => ({ ...r, x: 300, y: r0 + i * rowH + 6, w: 220, h: rowH - 12 }));
      const proxy = { x: 140, y: H / 2 - 52, w: 120, h: 104 };
      const client = { x: 10, y: H / 2 - 30, w: 88, h: 60 };
      layout = { ruleBoxes, svcBoxes, proxy, client, H };
      let s = `<svg viewBox="0 0 ${W} ${H}" class="rp-svg" role="img" aria-label="Ingress routing map">`;
      s += `<rect class="n-zone" x="128" y="6" width="${W - 134}" height="${H - 12}" rx="14"/><text class="lbl-xs t-muted" x="${W - 14}" y="22" text-anchor="end">cluster</text>`;
      s += `<rect class="n-client" x="${client.x}" y="${client.y}" width="${client.w}" height="${client.h}" rx="10"/><text class="lbl-b t-client" x="${client.x + client.w / 2}" y="${client.y + 26}" text-anchor="middle">client</text><text class="lbl-xs t-muted" x="${client.x + client.w / 2}" y="${client.y + 44}" text-anchor="middle">curl / browser</text>`;
      s += `<rect class="n-proxy" x="${proxy.x}" y="${proxy.y}" width="${proxy.w}" height="${proxy.h}" rx="12"/><text class="lbl-b t-proxy" x="${proxy.x + 60}" y="${proxy.y + 30}" text-anchor="middle">ingress proxy</text><text class="lbl-mono lbl-sm" x="${proxy.x + 60}" y="${proxy.y + 50}" text-anchor="middle">${SIM.IP}</text><text class="lbl-xs t-muted" x="${proxy.x + 60}" y="${proxy.y + 70}" text-anchor="middle">nginx · L7</text>`;
      s += `<g class="rp-tls" opacity="0"><rect class="badge" x="${proxy.x + 30}" y="${proxy.y + 80}" width="60" height="16" rx="8"/><text class="badge-t" x="${proxy.x + 60}" y="${proxy.y + 92}" text-anchor="middle">TLS ends</text></g>`;
      s += `<path class="edge-dim" d="M${client.x + client.w} ${client.y + client.h / 2} L${proxy.x} ${proxy.y + proxy.h / 2}"/>`;
      ruleBoxes.forEach((r, i) => {
        s += `<path class="edge-dim rp-e1" data-i="${i}" d="M${proxy.x + proxy.w} ${proxy.y + proxy.h / 2} C ${proxy.x + proxy.w + 30} ${proxy.y + proxy.h / 2}, ${r.x - 30} ${r.y + r.h / 2}, ${r.x} ${r.y + r.h / 2}"/>`;
        s += `<g class="rp-rule" data-i="${i}"><rect class="${r.default ? 'n-default' : 'n-ingress'}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8"/>`;
        if (r.default) s += `<text class="lbl-b t-default" x="${r.x + 12}" y="${r.y + 16}">defaultBackend</text><text class="lbl-xs t-muted" x="${r.x + 12}" y="${r.y + 31}">catches whatever no rule claims</text>`;
        else s += `<text class="lbl-mono lbl-sm" x="${r.x + 12}" y="${r.y + 16}">${esc(r.host)}</text><text class="lbl-mono" x="${r.x + 12}" y="${r.y + 32}">${esc(r.path)}</text><text class="lbl-xs t-muted" x="${r.x + r.w - 10}" y="${r.y + 32}" text-anchor="end">${esc(r.type)}</text>`;
        s += '</g>';
      });
      svcBoxes.forEach((b, si) => {
        s += `<g class="rp-svc" data-s="${esc(b.name)}"><rect class="n-svc" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/><text class="lbl-b t-svc" x="${b.x + 12}" y="${b.y + 20}">${esc(b.name)}</text><text class="lbl-xs t-muted" x="${b.x + b.w - 10}" y="${b.y + 20}" text-anchor="end">Service · endpoints</text>`;
        if (!b.pods.length) s += `<text class="lbl-xs t-default" x="${b.x + 12}" y="${b.y + 44}">no endpoints → 503</text>`;
        b.pods.forEach((p, pi) => { s += `<g class="rp-pod" data-p="${esc(p.name)}"><rect class="n-pod" x="${b.x + 10}" y="${b.y + 30 + pi * 24}" width="${b.w - 20}" height="19" rx="5"/><text class="lbl-xs lbl-mono" x="${b.x + 18}" y="${b.y + 43 + pi * 24}">${esc(p.name)}</text><text class="lbl-xs t-muted lbl-mono" x="${b.x + b.w - 16}" y="${b.y + 43 + pi * 24}" text-anchor="end">${esc(p.ip)}</text></g>`; });
        s += '</g>';
      });
      ruleBoxes.forEach((r, i) => {
        const n = r.backend.service ? r.backend.service.name : r.backend.resource.kind;
        const b = svcBoxes.find((x) => x.name === n);
        s += `<path class="edge-dim rp-e2" data-i="${i}" d="M${r.x + r.w} ${r.y + r.h / 2} C ${r.x + r.w + 20} ${r.y + r.h / 2}, ${b.x - 20} ${b.y + 18}, ${b.x} ${b.y + 18}"/>`;
      });
      s += `<path class="rp-trace" d="" /><circle class="packet rp-pk" r="6" cx="-20" cy="-20"/>`;
      if (!e.ready) s += `<g><rect class="n-default" x="300" y="${H / 2 - 30}" width="250" height="60" rx="10"/><text class="lbl-b t-default" x="425" y="${H / 2 - 4}" text-anchor="middle">no ingress controller yet</text><text class="lbl-xs t-muted" x="425" y="${H / 2 + 14}" text-anchor="middle">install it in 12.1.3 (or use catchup)</text></g>`;
      else if (!rules.length) s += `<g><rect class="n-api" x="300" y="${H / 2 - 30}" width="250" height="60" rx="10"/><text class="lbl-b" x="425" y="${H / 2 - 4}" text-anchor="middle">no Ingress objects yet</text><text class="lbl-xs t-muted" x="425" y="${H / 2 + 14}" text-anchor="middle">apply one in a terminal, then come back</text></g>`;
      s += '</svg>';
      stage.innerHTML = s;
    }
    function send() {
      const e = env();
      draw();
      const sch = scheme.value, h = host.value.trim().toLowerCase(), p = path.value.trim() || '/';
      const svg = $('svg', stage);
      if (!e.ready) { result.innerHTML = `<div class="rp-status bad">curl: (7) Failed to connect to ${esc(h)} port ${sch === 'https' ? 443 : 80}: Couldn't connect to server</div><p class="rp-why">Your simulated cluster has no running ingress controller, so nothing listens on ${SIM.IP}. Switch to "Final kiada Ingress" or install the controller in 12.1.3.</p>`; return; }
      const { route: r, resp } = SIM.request({ scheme: sch, host: h, path: p, method: 'GET' }, e, false);
      const { ruleBoxes, svcBoxes, proxy, client } = layout;
      let ri = -1;
      if (r.kind === 'rule') ri = ruleBoxes.findIndex((b) => !b.default && b.p === r.path);
      else if (r.kind === 'default') ri = ruleBoxes.findIndex((b) => b.default);
      const pts = [[client.x + client.w, client.y + client.h / 2], [proxy.x, proxy.y + proxy.h / 2], [proxy.x + proxy.w, proxy.y + proxy.h / 2]];
      let d = `M${pts[0]} L${pts[1]} L${pts[2]}`;
      let podEl = null;
      if (ri >= 0) {
        const rb = ruleBoxes[ri];
        d += ` C ${proxy.x + proxy.w + 30} ${proxy.y + proxy.h / 2}, ${rb.x - 30} ${rb.y + rb.h / 2}, ${rb.x} ${rb.y + rb.h / 2} L ${rb.x + rb.w} ${rb.y + rb.h / 2}`;
        if (resp.pod) {
          const sb = svcBoxes.find((b) => b.name === resp.svcName);
          const pi = sb.pods.findIndex((x) => x.name === resp.pod.name);
          const py = sb.y + 30 + pi * 24 + 9.5;
          d += ` C ${rb.x + rb.w + 24} ${rb.y + rb.h / 2}, ${sb.x - 24} ${py}, ${sb.x + 10} ${py}`;
          podEl = $(`.rp-pod[data-p="${resp.pod.name}"]`, svg);
          $(`.rp-svc[data-s="${resp.svcName}"]`, svg).classList.add('hit');
        }
        $(`.rp-rule[data-i="${ri}"]`, svg).classList.add('hit');
      } else {
        d += ` l 26 0`;
      }
      if (sch === 'https') $('.rp-tls', svg).setAttribute('opacity', '1');
      const trace = $('.rp-trace', svg);
      trace.setAttribute('d', d);
      trace.setAttribute('class', 'rp-trace ' + (resp.status >= 400 ? 'flow-bad' : sch === 'https' ? 'flow-tls' : 'flow'));
      const pk = $('.rp-pk', svg);
      pk.setAttribute('class', 'rp-pk ' + (resp.status >= 400 ? 'packet-bad' : sch === 'https' ? 'packet-tls' : 'packet'));
      const len = trace.getTotalLength();
      const t0 = performance.now(), dur = 1300;
      const anim = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e2 = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const pt = trace.getPointAtLength(e2 * len);
        pk.setAttribute('cx', pt.x); pk.setAttribute('cy', pt.y);
        if (k < 1) requestAnimationFrame(anim); else if (podEl) podEl.classList.add('hit');
      };
      requestAnimationFrame(anim);

      let why;
      if (r.kind === 'rule') {
        why = `Host <code>${esc(h)}</code> ${r.hostScore === 2 ? 'matched a rule exactly' : r.hostScore === 1 ? 'matched a wildcard rule' : 'hit a rule with no host'}; path <code>${esc(p)}</code> matched <code>${esc(r.path.path || '/')}</code> (${esc(r.path.pathType)}).`;
        if (resp.pod) why += ` The proxy picked <b>${esc(resp.pod.name)}</b> from the <code>${esc(resp.svcName)}</code> Service's endpoints and sent the request straight to <code>${esc(resp.podAddr)}</code>, not to the ClusterIP.`;
      } else if (r.kind === 'default') why = r.hostMatched ? `The host matched a rule, but no path under it fits <code>${esc(p)}</code>, so the request fell through to the default backend.` : `No rule has host <code>${esc(h)}</code>, so the request fell through to the default backend.`;
      else why = r.hostMatched ? 'Host matched, path did not, and there is no default backend: nginx answers 404 itself.' : 'No rule matches this Host header and there is no default backend: nginx answers with its own 404 page.';
      if (resp.problem) why += ` <b>${esc(resp.problem)}</b>, so nginx returns 503.`;
      if (sch === 'https') why += mode === 'book' || Object.keys(SIM.state().secrets).length ? ' The proxy terminated TLS with the <code>tls-example-com</code> certificate; the pod saw plain HTTP.' : ' No TLS Secret configured: nginx would present its fake default certificate.';
      const body = resp.body.length > 520 ? resp.body.slice(0, 520) + '…' : resp.body;
      result.innerHTML = `<div class="rp-status ${resp.status < 400 ? 'good' : 'bad'}">${sch === 'https' ? 'HTTP/2' : 'HTTP/1.1'} ${resp.status} ${esc(resp.statusText || '')}<span>${esc(sch)}://${esc(h)}${esc(p)}</span></div><p class="rp-why">${why}</p><pre class="rp-body">${esc(body)}</pre>`;
    }
    draw();
    SIM.on(() => { if (mode === 'live') draw(); });
  }

  // ---------- LB vs Ingress ----------
  function lbVsIngress(el) {
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">slider</span><b>One public IP per Service, or one for all?</b></div>
      <div class="lb-ctl"><label>services to expose <input type="range" min="1" max="24" value="6" class="lb-n"><b class="lb-nv">6</b></label>
      <label>illustrative cost per cloud load balancer <span class="lb-cur">$</span><input type="number" min="0" max="200" value="18" class="lb-cost"><span>/month</span></label></div>
      <div class="lb-cols"><div class="lb-col"><div class="lb-title">type: LoadBalancer on each Service</div><div class="lb-svg a"></div><div class="lb-sum a"></div></div>
      <div class="lb-col"><div class="lb-title">one Ingress in front of ClusterIP Services</div><div class="lb-svg b"></div><div class="lb-sum b"></div></div></div>`;
    const n = $('.lb-n', el), cost = $('.lb-cost', el);
    const names = ['kiada', 'quote', 'quiz', 'auth', 'cart', 'search', 'media', 'admin', 'docs', 'chat', 'pay', 'feed', 'mail', 'maps', 'blog', 'shop', 'api', 'img', 'news', 'jobs', 'wiki', 'stats', 'store', 'help'];
    function upd() {
      const N = +n.value, c = +cost.value || 0;
      $('.lb-nv', el).textContent = N;
      const cols = Math.min(N, 6), rows = Math.ceil(N / 6);
      const W = 340, cw = 52, gx = (W - cols * cw) / (cols + 1), H = 40 + rows * 78;
      let a = `<svg viewBox="0 0 ${W} ${H}">`;
      for (let i = 0; i < N; i++) {
        const x = gx + (i % 6) * (cw + gx), y = 14 + Math.floor(i / 6) * 78;
        a += `<rect class="n-lb" x="${x + 8}" y="${y}" width="${cw - 16}" height="16" rx="8"/><text class="lbl-xs lbl-mono" x="${x + cw / 2}" y="${y + 12}" text-anchor="middle">IP ${i + 1}</text><path class="edge" d="M${x + cw / 2} ${y + 17} V ${y + 30}" marker-end="url(#arrow)"/><rect class="n-svc" x="${x}" y="${y + 34}" width="${cw}" height="24" rx="6"/><text class="lbl-xs" x="${x + cw / 2}" y="${y + 50}" text-anchor="middle">${names[i]}</text>`;
      }
      a += '</svg>';
      let b = `<svg viewBox="0 0 ${W} ${H}">`;
      b += `<rect class="n-lb" x="${W / 2 - 28}" y="6" width="56" height="16" rx="8"/><text class="lbl-xs lbl-mono" x="${W / 2}" y="18" text-anchor="middle">IP 1</text><rect class="n-proxy" x="${W / 2 - 60}" y="30" width="120" height="26" rx="8"/><text class="lbl-sm lbl-b t-proxy" x="${W / 2}" y="47" text-anchor="middle">Ingress</text>`;
      const cb = Math.min(N, 6), gb = (W - cb * cw) / (cb + 1);
      for (let i = 0; i < N; i++) {
        const x = gb + (i % 6) * (cw + gb), y = 74 + Math.floor(i / 6) * 40;
        b += `<path class="edge-dim" d="M${W / 2} 56 C ${W / 2} 66, ${x + cw / 2} ${y - 12}, ${x + cw / 2} ${y}"/><rect class="n-svc" x="${x}" y="${y}" width="${cw}" height="24" rx="6"/><text class="lbl-xs" x="${x + cw / 2}" y="${y + 16}" text-anchor="middle">${names[i]}</text>`;
      }
      b += '</svg>';
      $('.lb-svg.a', el).innerHTML = a;
      $('.lb-svg.b', el).innerHTML = b;
      $('.lb-sum.a', el).innerHTML = `<b>${N}</b> public IPs · <b>${N}</b> load balancers · ≈ <b>$${N * c}</b>/mo · TLS configured ${N}×`;
      $('.lb-sum.b', el).innerHTML = `<b>1</b> public IP · <b>1</b> load balancer · ≈ <b>$${c}</b>/mo · TLS configured once`;
    }
    n.oninput = cost.oninput = upd;
    upd();
  }

  // ---------- cluster HUD (sidebar) ----------
  function hud(el) {
    function render() {
      const S = SIM.state();
      const ctrl = !SIM.controllerInstalled() ? ['off', 'not installed'] : SIM.controllerReady() ? ['on', 'ready'] : ['warm', 'starting…'];
      const ings = Object.values(S.ingresses).sort((a, b) => a.created - b.created);
      el.innerHTML = `
        <div class="hud-h">simulated cluster <button class="hud-open" title="Open the drop-down shell (\` key)">›_ shell</button></div>
        <div class="hud-row"><span class="dot ${ctrl[0]}"></span>ingress-nginx <em>${ctrl[1]}</em></div>
        <div class="hud-sub">Ingresses</div>
        ${ings.length ? ings.map((i) => `<div class="hud-ing"><span class="dot ${SIM.ingAddress(i) ? 'on' : 'off'}"></span><code>${esc(i.name)}</code><em>${esc(i.cls || 'no class')}</em></div>`).join('') : '<div class="hud-none">none yet</div>'}
        <div class="hud-sub">extras</div>
        <div class="hud-tags">${[S.pods.fun404 ? 'fun404' : null, ...Object.keys(S.secrets).map((s) => '🔑 ' + s), S.hosts.length ? '/etc/hosts ✓' : null].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('') || '<span class="hud-none">—</span>'}</div>`;
      $('.hud-open', el).onclick = () => window.APP && window.APP.toggleDock(true);
    }
    render();
    SIM.on(render);
    setInterval(render, 2000);
  }

  window.WIDGETS = {
    init(root = document) {
      $$('.code[data-src]', root).forEach(codeBlock);
      $$('pre.snippet', root).forEach(snippet);
      $$('.quiz', root).forEach(quiz);
      $$('.tabset', root).forEach(tabset);
      $$('figure.stepper', root).forEach(stepper);
      $$('.widget.path-matcher', root).forEach(pathMatcher);
      $$('.widget.host-matcher', root).forEach(hostMatcher);
      $$('.widget.router-playground', root).forEach(routerPlayground);
      $$('.widget.lb-vs-ingress', root).forEach(lbVsIngress);
      $$('.term:not(.term-ready)', root).forEach((t) => new Term(t));
    },
    hud,
  };
})();
