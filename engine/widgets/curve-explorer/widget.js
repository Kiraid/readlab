// curve-explorer: how one quantity changes as another varies. Curves are formulas of x and the sliders
// (`(n - 1) * (x + c) / 2`) or data points the book gives; the reader drags the sliders and the probe and reads
// the values off. Formulas go through a small parser of their own (numbers, x, slider ids, + - * / ^ %,
// parentheses, a few functions); nothing is ever evaluated as JavaScript. check() runs the same parser at
// build time, so a broken formula is a build error, not a blank chart.
(() => {
  const FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sqrt: Math.sqrt, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10, pow: Math.pow };

  // expr -> (env) => number. Grammar: sum := prod (('+'|'-') prod)* ; prod := unary (('*'|'/'|'%') unary)* ;
  // unary := '-' unary | power ; power := atom ('^' unary)? ; atom := number | name | name '(' args ')' | '(' sum ')'
  function compile(src, names) {
    const toks = String(src).match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_]\w*|[-+*/%^(),]|\S/g) || [];
    let i = 0;
    const peek = () => toks[i], take = () => toks[i++];
    const fail = (m) => { throw new Error(`formula "${src}": ${m}`); };
    const expect = (t) => (take() === t ? t : fail(`expected "${t}"`));
    function sum() {
      let f = prod();
      while (peek() === '+' || peek() === '-') { const op = take(), a = f, b = prod(); f = op === '+' ? (e) => a(e) + b(e) : (e) => a(e) - b(e); }
      return f;
    }
    function prod() {
      let f = unary();
      while (['*', '/', '%'].includes(peek())) {
        const op = take(), a = f, b = unary();
        f = op === '*' ? (e) => a(e) * b(e) : op === '/' ? (e) => a(e) / b(e) : (e) => a(e) % b(e);
      }
      return f;
    }
    function unary() { if (peek() === '-') { take(); const a = unary(); return (e) => -a(e); } return power(); }
    function power() { const a = atom(); if (peek() === '^') { take(); const b = unary(); return (e) => a(e) ** b(e); } return a; }
    function atom() {
      const t = take();
      if (t === undefined) fail('ends too early');
      if (/^\d/.test(t)) { const v = +t; return () => v; }
      if (t === '(') { const a = sum(); expect(')'); return a; }
      if (/^[A-Za-z_]/.test(t)) {
        if (peek() === '(') {
          if (!FUNCS[t]) fail(`unknown function "${t}" (allowed: ${Object.keys(FUNCS).join(', ')})`);
          take();
          const args = [];
          if (peek() !== ')') { args.push(sum()); while (peek() === ',') { take(); args.push(sum()); } }
          expect(')');
          const fn = FUNCS[t];
          return (e) => fn(...args.map((a) => a(e)));
        }
        if (!names.includes(t)) fail(`unknown name "${t}" (use x and the slider ids: ${names.filter((n) => n !== 'x').join(', ') || 'none'})`);
        return (e) => e[t];
      }
      return fail(`unexpected "${t}"`);
    }
    const f = sum();
    if (i < toks.length) fail(`unexpected "${toks[i]}"`);
    return f;
  }

  // round steps (1, 2, 5 × 10^k) giving at most `n` ticks
  const niceStep = (span, n) => { const p = 10 ** Math.floor(Math.log10(span / n || 1)); return [1, 2, 5, 10].map((m) => m * p).find((s) => span / s <= n); };
  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100));

  WIDGETS.register('curve-explorer', {
    check(c) {
      const errs = [];
      const xr = c.x || {}, lo = xr.min ?? 0;
      const names = ['x', ...(c.params || []).map((p) => p.id)];
      const env = Object.fromEntries((c.params || []).map((p) => [p.id, p.default ?? p.min]));
      (c.curves || []).forEach((cv, k) => {
        if (!cv.expr && !cv.points) errs.push(`curves[${k}]: give a formula (expr) or the book's data (points)`);
        if (cv.expr && cv.points) errs.push(`curves[${k}]: either a formula (expr) or data (points), not both`);
        if (cv.expr) {
          try {
            const f = compile(cv.expr, names);
            const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * ((xr.max ?? lo + 1) - lo));
            if (!xs.some((x) => Number.isFinite(f({ ...env, x })))) errs.push(`curves[${k}]: formula gives no finite value on the x range`);
          } catch (e) { errs.push(`curves[${k}]: ${e.message}`); }
        }
      });
      (c.params || []).forEach((p, k) => { if (!(p.max > p.min)) errs.push(`params[${k}]: max must be above min`); });
      if (!(xr.max > lo)) errs.push('x: max must be above min');
      (c.curves || []).forEach((cv, k) => (cv.points || []).forEach((p, j) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) errs.push(`curves[${k}].points[${j}]: write [x, y] with two numbers`);
      }));
      return errs;
    },

    render(el, c, h) {
      const params = c.params || [], curves = c.curves || [], marks = c.marks || [];
      const x0 = c.x.min ?? 0, x1 = c.x.max, xu = c.x.unit || '', yu = c.y.unit || '';
      const names = ['x', ...params.map((p) => p.id)];
      const fns = curves.map((cv) => (cv.expr ? compile(cv.expr, names) : null));
      const data = curves.map((cv) => (cv.points ? [...cv.points].sort((a, b) => a[0] - b[0]) : null));  // the book's points, by x
      el.innerHTML = `
        <div class="w-head"><span class="w-tag">curves</span><b>${h.esc(c.title || 'Explore the curve')}</b></div>
        ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
        ${params.map((p, k) => `<div class="w-row"><span class="w-lbl">${h.esc(p.label || p.id)}</span>
          <input type="range" data-k="${k}" min="${p.min}" max="${p.max}" step="${p.step ?? niceStep(p.max - p.min, 100)}" value="${p.default ?? p.min}"><b class="cx-v"></b></div>`).join('')}
        <svg class="w-svg cx-svg"></svg>
        <div class="w-row"><span class="w-lbl">${h.esc(c.x.label)} =</span><input type="range" class="cx-probe" min="${x0}" max="${x1}" step="${niceStep(x1 - x0, 200)}" value="${c.probe ?? (x0 + x1) / 2}"><b class="cx-px"></b></div>
        <div class="w-out cx-out"></div>
        ${c.note ? `<p class="w-sub">${h.md(c.note)}</p>` : ''}`;
      const svg = el.querySelector('svg');
      const sliders = [...el.querySelectorAll('input[data-k]')], probe = el.querySelector('.cx-probe');
      const W = 720, H = 300, L = 64, R = 16, T = 14, B = 44;

      function draw() {
        const env = {};
        sliders.forEach((s, k) => { env[params[k].id] = +s.value; s.nextElementSibling.textContent = fmt(+s.value) + (params[k].unit || ''); });
        const N = 160, samples = curves.map((cv, k) => (fns[k]
          ? Array.from({ length: N + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / N; return [x, fns[k]({ ...env, x })]; })
          : data[k]));
        const finite = samples.flat().map((p) => p[1]).filter(Number.isFinite);
        const y0 = c.y.min ?? Math.min(0, ...finite);
        let y1 = c.y.max ?? Math.max(...finite, y0 + 1);
        if (c.y.max === undefined) { const s = niceStep(y1 - y0, 6); y1 = Math.ceil(y1 / s) * s; }
        const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
        const Y = (y) => H - B - ((Math.min(Math.max(y, y0), y1) - y0) / (y1 - y0)) * (H - T - B);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.innerHTML = '';
        const sx = niceStep(x1 - x0, 10), sy = niceStep(y1 - y0, 6);
        for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) {
          h.svgEl('line', { class: 'cx-grid', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }, svg);
          h.svgEl('text', { class: 'cx-tick', x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(v);
        }
        for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) {
          h.svgEl('text', { class: 'cx-tick', x: X(v), y: H - B + 16, 'text-anchor': 'middle' }, svg).textContent = fmt(v);
        }
        h.svgEl('line', { class: 'cx-axis', x1: L, x2: W - R, y1: H - B, y2: H - B }, svg);
        h.svgEl('line', { class: 'cx-axis', x1: L, x2: L, y1: T, y2: H - B }, svg);
        h.svgEl('text', { class: 'cx-alabel', x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = c.x.label + (xu ? ` (${xu})` : '');
        const yl = h.svgEl('text', { class: 'cx-alabel', x: 14, y: (T + H - B) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(T + H - B) / 2})` }, svg);
        yl.textContent = c.y.label + (yu ? ` (${yu})` : '');
        marks.forEach((m) => {
          h.svgEl('line', { class: 'cx-mark', x1: X(m.at), x2: X(m.at), y1: T, y2: H - B }, svg);
          const right = X(m.at) > W - R - 160;  // near the right edge the label ends at the mark instead of starting there
          const t = h.svgEl('text', { class: 'cx-tick', x: X(m.at) + (right ? -4 : 4), y: T + 10 }, svg);
          if (right) t.style.textAnchor = 'end';
          t.textContent = m.label || '';
        });
        samples.forEach((pts, k) => {
          const d = pts.filter(([, y]) => Number.isFinite(y)).map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ');
          h.svgEl('path', { class: `cx-line cx-c${k % 4}`, d }, svg);
          if (!fns[k]) pts.forEach(([x, y]) => h.svgEl('circle', { class: `cx-dot cx-c${k % 4}`, cx: X(x), cy: Y(y), r: 3.5 }, svg));
        });
        const px = +probe.value;
        h.svgEl('line', { class: 'cx-probe-line', x1: X(px), x2: X(px), y1: T, y2: H - B }, svg);
        el.querySelector('.cx-px').textContent = fmt(px) + (xu ? ' ' + xu : '');
        const at = curves.map((cv, k) => {
          let y;
          if (fns[k]) y = fns[k]({ ...env, x: px });
          else { // the book's points: straight-line between neighbours, nothing beyond the data
            const p = data[k], j = p.findIndex(([x]) => x >= px);
            y = j < 0 || (j === 0 && p[0][0] > px) ? NaN : j === 0 ? p[0][1] : p[j - 1][1] + ((px - p[j - 1][0]) / (p[j][0] - p[j - 1][0])) * (p[j][1] - p[j - 1][1]);
          }
          if (Number.isFinite(y)) h.svgEl('circle', { class: `cx-dot cx-c${k % 4}`, cx: X(px), cy: Y(y), r: 5 }, svg);
          return `<span class="cx-key cx-k${k % 4}"></span>${h.esc(cv.label)}: <b>${Number.isFinite(y) ? fmt(y) + (yu ? ' ' + h.esc(yu) : '') : '–'}</b>`;
        });
        el.querySelector('.cx-out').innerHTML = `<b>at ${h.esc(c.x.label)} = ${fmt(px)}${xu ? ' ' + h.esc(xu) : ''}:</b> ${at.join(' · ')}`;
      }
      [...sliders, probe].forEach((s) => s.addEventListener('input', draw));
      draw();
    },
  });
})();
