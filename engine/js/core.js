// Core page blocks (code, snippets, quizzes, tabs, steppers) and the widget registry.
//
// Catalog widgets live in engine/widgets/<name>/widget.js and register themselves:
//   WIDGETS.register('compare-scale', { render(el, config, h) { ... } })
// The builder emits <div class="widget" data-widget="compare-scale" data-config="{json}">
// and includes only the widgets a page uses.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hlY = (t) => (window.hlYAML ? window.hlYAML(t) : esc(t));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const SVGNS = 'http://www.w3.org/2000/svg';
  const SHELL = (window.CHAPTER && window.CHAPTER.shell) || {};

  // ---------- helpers handed to every widget ----------
  function svgEl(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Matchers shared by rule-tester, request-tracer and anything else that matches inputs.
  // Each returns { ok, why }.
  const segs = (p) => String(p).split('/').filter(Boolean);
  const MATCH = {
    exact: (v, p) => ({ ok: v === p, why: v === p ? 'identical' : `"${v}" ≠ "${p}"` }),
    prefix: (v, p) => ({ ok: v.startsWith(p), why: v.startsWith(p) ? `starts with "${p}"` : `does not start with "${p}"` }),
    'path-prefix': (v, p) => {
      const a = segs(v), b = segs(p);
      const ok = b.every((s, i) => a[i] === s);
      const bad = b.findIndex((s, i) => a[i] !== s);
      return { ok, why: ok ? `segments [${b.join(', ')}] all match` : `segment ${bad + 1}: "${a[bad] ?? '(none)'}" ≠ "${b[bad]}"` };
    },
    glob: (v, p) => {
      const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const ok = re.test(v);
      return { ok, why: ok ? 'glob matches' : 'glob does not match' };
    },
    regex: (v, p) => {
      let ok = false;
      try { ok = new RegExp(p).test(v); } catch (e) { return { ok: false, why: 'invalid regex' }; }
      return { ok, why: ok ? `matches /${p}/` : `no match for /${p}/` };
    },
    host: (v, p) => {
      if (!p.startsWith('*.')) return MATCH.exact(v.toLowerCase(), p.toLowerCase());
      const suffix = p.slice(1).toLowerCase(), h = v.toLowerCase();
      const ok = h.endsWith(suffix) && !h.slice(0, -suffix.length).includes('.') && h.length > suffix.length;
      return { ok, why: ok ? `one label before "${suffix}"` : h.endsWith(suffix) ? 'wildcard covers exactly one label' : `does not end with "${suffix}"` };
    },
    cidr: (v, p) => {
      const ip = (s) => s.split('.').reduce((a, o) => (a << 8) + (+o), 0) >>> 0;
      const [net, bits] = p.split('/');
      const mask = bits === '0' ? 0 : (~0 << (32 - +bits)) >>> 0;
      const ok = /^\d+\.\d+\.\d+\.\d+$/.test(v) && ((ip(v) & mask) >>> 0) === ((ip(net) & mask) >>> 0);
      return { ok, why: ok ? `inside ${p}` : `outside ${p}` };
    },
    any: () => ({ ok: true, why: 'matches anything' }),
  };
  // "kind:pattern" or a plain value (exact)
  function matchSpec(value, spec) {
    const m = /^(exact|prefix|path-prefix|glob|regex|host|cidr|any):(.*)$/.exec(String(spec));
    return m ? MATCH[m[1]](String(value), m[2]) : MATCH.exact(String(value), String(spec));
  }

  const helpers = { esc, md, svgEl, $, $$, MATCH, matchSpec };

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
    const lines = (/\.ya?ml$/.test(src) ? hlY(text) : esc(text)).split('\n');
    const run = SHELL.run_file ? SHELL.run_file.replace('{file}', src) : null;
    el.innerHTML = `
      <div class="code-head"><span class="fname">${esc(src)}</span>${kinds ? `<span class="kind">${esc(kinds)}</span>` : ''}
        <span class="code-actions">${run ? `<button class="cbtn run" title="Run ${esc(run)} in the drop-down shell">▶ ${esc(run.split(' ').slice(0, 2).pop())}</button>` : ''}<button class="cbtn copy">copy</button></span></div>
      <pre><code>${lines.map((l, i) => `<span class="cl${hl.has(i + 1) ? ' hl' : ''}"><span class="n">${i + 1}</span>${l || ' '}</span>`).join('')}</code></pre>`;
    $('.copy', el).addEventListener('click', (e) => { navigator.clipboard && navigator.clipboard.writeText(text); e.target.textContent = 'copied'; setTimeout(() => (e.target.textContent = 'copy'), 1200); });
    if (run) $('.run', el).addEventListener('click', () => window.APP && window.APP.runInDock(run));
  }

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
  const SQL_KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|BEGIN|COMMIT|ROLLBACK|AND|OR|NOT|NULL|AS|DISTINCT|EXPLAIN|ANALYZE|PRIMARY|KEY|REFERENCES|TRANSACTION|ISOLATION|LEVEL)\b/gi;
  function snippet(el) {
    const lang = el.dataset.lang;
    const text = el.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    if (lang === 'yaml') el.innerHTML = hlY(text);
    else if (lang === 'http') el.innerHTML = hlHTTP(text);
    else if (lang === 'bash' || lang === 'shell' || lang === 'sh') el.innerHTML = esc(text).replace(/^(\$ )/gm, '<span class="y-com">$1</span>');
    else if (lang === 'sql') el.innerHTML = esc(text).replace(SQL_KW, '<span class="y-key">$&</span>').replace(/(--.*)$/gm, '<span class="y-com">$1</span>');
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
        if (wrong >= 2 && explain) explain.classList.add('show');
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
    if (!svg) return;
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

  // ---------- registry ----------
  const REGISTRY = {};
  function widget(el) {
    const name = el.dataset.widget;
    const def = REGISTRY[name];
    if (!def) { el.innerHTML = `<p class="w-sub">Widget <code>${esc(name)}</code> is not included in this page.</p>`; return; }
    let cfg = {};
    try { cfg = JSON.parse(el.dataset.config || '{}'); } catch (e) { console.error(`bad config for widget ${name}`, e); }
    try { def.render(el, cfg, helpers); } catch (e) { console.error(`widget ${name} failed`, e); el.innerHTML = `<p class="w-sub">Widget <code>${esc(name)}</code> failed to render: ${esc(e.message)}</p>`; }
  }

  window.WIDGETS = {
    register(name, def) { REGISTRY[name] = def; },
    registered: () => Object.keys(REGISTRY),
    helpers,
    init(root = document) {
      const once = (sel, fn) => $$(sel, root).forEach((e) => { if (e.dataset.wready) return; e.dataset.wready = '1'; fn(e); });
      if (window.DIAGRAM) DIAGRAM.renderAll(root);
      once('.code[data-src]', codeBlock);
      once('pre.snippet', snippet);
      once('.quiz', quiz);
      once('.tabset', tabset);
      once('.widget[data-widget]', widget);
      once('figure.stepper', stepper);
      $$('.term:not(.term-ready)', root).forEach((t) => new window.Term(t));
    },
  };
})();
