// Diagram renderer. Input: the normalised spec from tools/format/diagram.mjs (inlined as JSON in
// <figure class="diagram dsl" data-dsl="flow|sequence">). The renderer owns all geometry: it measures
// text, sizes boxes to fit, places them on the grid, routes edges, spreads ports, draws arrowheads,
// labels and packets, and wires steps. Widgets reuse DIAGRAM.flow() for their own drawings.
(function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const F = {
    label: '600 13.5px Inter, system-ui, sans-serif',
    sub: '500 11.5px "JetBrains Mono", ui-monospace, monospace',
    edge: '500 11.5px Inter, system-ui, sans-serif',
  };
  const EDGE_CLASS = { edge: 'edge', dim: 'edge-dim', flow: 'flow', secure: 'flow-tls', error: 'flow-bad', ok: 'flow-ok', reply: 'edge reply' };
  const MARKER = { edge: 'arrow', dim: 'arrow', flow: 'arrow-accent', secure: 'arrow-tls', error: 'arrow-bad', ok: 'arrow', reply: 'arrow' };
  const PACKET = { flow: 'packet', secure: 'packet-tls', error: 'packet-bad', ok: 'packet' };

  let ctx2d;
  function measure(text, font) {
    if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
    ctx2d.font = font;
    return Math.ceil(ctx2d.measureText(String(text || '')).width * 1.04);
  }
  function wrap(text, max, font) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (measure(t, font) <= max || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines;
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, cls, anchor = 'middle') {
    const t = el('text', { x, y, class: cls, 'text-anchor': anchor }, parent);
    t.textContent = str;
    return t;
  }
  const cubicAt = (p, t) => {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
  };
  function cubicLen(p) {
    let len = 0, prev = p[0];
    for (let i = 1; i <= 16; i++) { const q = cubicAt(p, i / 16); len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
    return len;
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const dOf = (p) => `M${r1(p[0][0])} ${r1(p[0][1])} C${r1(p[1][0])} ${r1(p[1][1])}, ${r1(p[2][0])} ${r1(p[2][1])}, ${r1(p[3][0])} ${r1(p[3][1])}`;

  function addPacket(svg, d, len, style, begin) {
    const c = el('circle', { class: PACKET[style] || 'packet', r: 4.5 }, svg);
    el('animateMotion', { dur: `${Math.max(1.4, Math.min(4, len / 95)).toFixed(2)}s`, repeatCount: 'indefinite', begin: `${begin.toFixed(2)}s`, path: d }, c);
    return c;
  }

  // ------------------------------------------------------------------ flow
  function flow(spec, opts = {}) {
    const nodes = spec.nodes.map((n) => {
      const lines = wrap(n.label, 184, F.label);
      const lw = Math.max(...lines.map((l) => measure(l, F.label)));
      const sw = n.sub ? measure(n.sub, F.sub) : 0;
      const w = Math.max(92, Math.min(230, Math.max(lw, sw) + 30));
      const h = 16 + lines.length * 17 + (n.sub ? 16 : 0) + 8;
      return { ...n, lines, w, h };
    });
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const ncol = Math.max(...nodes.map((n) => n.col)) + 1;
    const nrow = Math.max(...nodes.map((n) => n.row)) + 1;
    const colW = Array.from({ length: ncol }, (_, c) => Math.max(40, ...nodes.filter((n) => n.col === c).map((n) => n.w)));
    const rowH = Array.from({ length: nrow }, (_, r) => Math.max(43, ...nodes.filter((n) => n.row === r).map((n) => n.h)));
    const gap = Array(ncol).fill(72);
    const rgap = Array(nrow).fill(34);
    for (const e of spec.edges) {
      const a = byId[e.from], b = byId[e.to];
      if (!a || !b || !e.label) continue;
      const lw = measure(e.label, F.edge) + 34;
      const [c0, c1] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
      if (c1 > c0) for (let c = c0; c < c1; c++) gap[c] = Math.max(gap[c], lw / (c1 - c0));
      else { const r0 = Math.min(a.row, b.row); rgap[r0] = Math.max(rgap[r0], 40); }
    }
    const groupPad = spec.groups && spec.groups.length ? 26 : 0;
    const M = 18 + groupPad;
    const colX = [M];
    for (let c = 1; c < ncol; c++) colX[c] = colX[c - 1] + colW[c - 1] + gap[c - 1];
    const rowY = [M];
    for (let r = 1; r < nrow; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + rgap[r - 1];
    for (const n of nodes) {
      n.x = colX[n.col] + (colW[n.col] - n.w) / 2;
      n.y = rowY[n.row] + (rowH[n.row] - n.h) / 2;
      n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2;
    }

    // ---- edge geometry, with ports spread along each side
    const pairs = new Set(spec.edges.map((e) => `${e.from}>${e.to}`));
    const blocked = (a, b) => a.row === b.row && Math.abs(a.col - b.col) > 1 &&
      nodes.some((n) => n.row === a.row && n.col > Math.min(a.col, b.col) && n.col < Math.max(a.col, b.col));
    const geo = spec.edges.map((e) => {
      const a = byId[e.from], b = byId[e.to];
      let sideA, sideB;
      if (blocked(a, b)) { sideA = 'top'; sideB = 'top'; }
      else if (b.col > a.col) { sideA = 'right'; sideB = 'left'; }
      else if (b.col < a.col) { sideA = 'left'; sideB = 'right'; }
      else if (b.row > a.row) { sideA = 'bottom'; sideB = 'top'; }
      else { sideA = 'top'; sideB = 'bottom'; }
      return { e, a, b, sideA, sideB, offA: 0, offB: 0, rev: pairs.has(`${e.to}>${e.from}`) };
    });
    const bucket = new Map();
    for (const g of geo) {
      for (const [node, side, key, other] of [[g.a, g.sideA, 'offA', g.b], [g.b, g.sideB, 'offB', g.a]]) {
        const k = node.id + ':' + side;
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push({ g, key, other, side });
      }
    }
    for (const list of bucket.values()) {
      if (list.length < 2) continue;
      const vertical = list[0].side === 'left' || list[0].side === 'right';
      list.sort((p, q) => (vertical ? p.other.cy - q.other.cy : p.other.cx - q.other.cx));
      const n = list.length;
      list.forEach((it, i) => { it.g[it.key] = (i - (n - 1) / 2) * Math.min(12, 30 / (n - 1)); });
    }
    const port = (n, side, off) => ({
      right: [n.x + n.w, n.cy + off], left: [n.x, n.cy + off], top: [n.cx + off, n.y], bottom: [n.cx + off, n.y + n.h],
    })[side];
    for (const g of geo) {
      if (g.rev && g.offA === 0 && g.offB === 0) { const s = g.e.from < g.e.to ? -7 : 7; g.offA = s; g.offB = s; }
      const p0 = port(g.a, g.sideA, g.offA), p3 = port(g.b, g.sideB, g.offB);
      let p1, p2;
      if (g.sideA === 'top' && g.sideB === 'top') {
        const lift = Math.min(p0[1], p3[1]) - 46;
        p1 = [p0[0], lift]; p2 = [p3[0], lift];
      } else if (g.sideA === 'right' || g.sideA === 'left') {
        const dx = Math.max(28, Math.abs(p3[0] - p0[0]) * 0.5) * (g.sideA === 'right' ? 1 : -1);
        p1 = [p0[0] + dx, p0[1]]; p2 = [p3[0] - dx, p3[1]];
      } else {
        const dy = Math.max(20, Math.abs(p3[1] - p0[1]) * 0.5) * (g.sideA === 'bottom' ? 1 : -1);
        p1 = [p0[0], p0[1] + dy]; p2 = [p3[0], p3[1] - dy];
      }
      // stop short of the box so the arrowhead tip touches it
      const dir = [p3[0] - p2[0], p3[1] - p2[1]];
      const dl = Math.hypot(...dir) || 1;
      const end = [p3[0] - (dir[0] / dl) * 2, p3[1] - (dir[1] / dl) * 2];
      g.pts = [p0, p1, p2, end];
      g.d = dOf(g.pts);
      g.len = cubicLen(g.pts);
      g.mid = cubicAt(g.pts, 0.5);
    }

    // ---- canvas size (content plus groups, never narrower than minWidth)
    const groups = (spec.groups || []).map((gr) => {
      const ms = gr.nodes.map((id) => byId[id]).filter(Boolean);
      const x0 = Math.min(...ms.map((n) => n.x)) - 16, y0 = Math.min(...ms.map((n) => n.y)) - 24;
      const x1 = Math.max(...ms.map((n) => n.x + n.w)) + 16, y1 = Math.max(...ms.map((n) => n.y + n.h)) + 14;
      return { ...gr, x0, y0, x1, y1 };
    });
    const xs = [...nodes.flatMap((n) => [n.x, n.x + n.w]), ...groups.flatMap((g) => [g.x0, g.x1]), ...geo.map((g) => g.mid[0])];
    const ys = [...nodes.flatMap((n) => [n.y, n.y + n.h]), ...groups.flatMap((g) => [g.y0, g.y1]), ...geo.flatMap((g) => [g.pts[1][1], g.mid[1] - 12])];
    let minX = Math.min(...xs) - 14, maxX = Math.max(...xs) + 14;
    const minY = Math.min(...ys) - 12, maxY = Math.max(...ys) + 12;
    const minW = opts.minWidth ?? 560;
    if (maxX - minX < minW) { const pad = (minW - (maxX - minX)) / 2; minX -= pad; maxX += pad; }
    const W = maxX - minX, H = maxY - minY;

    const svg = el('svg', { viewBox: `${r1(minX)} ${r1(minY)} ${r1(W)} ${r1(H)}`, role: 'img', class: 'dsl-svg' });
    svg.style.maxWidth = `${Math.round(W * 1.15)}px`;
    const firstStep = {};
    (spec.steps || []).forEach((s, i) => s.show.forEach((id) => { if (!(id in firstStep)) firstStep[id] = i + 1; }));

    for (const gr of groups) {
      const gEl = el('g', { 'data-step': firstStep[gr.id] }, svg);
      el('rect', { class: 'n-zone', x: r1(gr.x0), y: r1(gr.y0), width: r1(gr.x1 - gr.x0), height: r1(gr.y1 - gr.y0), rx: 14 }, gEl);
      text(gEl, gr.x1 - 10, gr.y0 + 14, gr.label, 'lbl-xs t-muted', 'end');
    }
    const edgeEls = {};
    const packetLayer = [];
    geo.forEach((g, i) => {
      const style = g.e.style;
      const gEl = el('g', { class: 'de', 'data-id': g.e.id, 'data-step': firstStep[g.e.id] }, svg);
      el('path', { class: EDGE_CLASS[style], d: g.d, 'marker-end': `url(#${MARKER[style]})` }, gEl);
      if (g.e.label) {
        const lw = measure(g.e.label, F.edge) + 12;
        const [mx, my] = g.mid;
        el('rect', { class: 'elbl-bg', x: r1(mx - lw / 2), y: r1(my - 10), width: r1(lw), height: 19, rx: 9.5 }, gEl);
        text(gEl, r1(mx), r1(my + 4), g.e.label, style === 'dim' ? 'elbl t-muted' : 'elbl');
      }
      edgeEls[g.e.id] = { el: gEl, d: g.d, len: g.len, pts: g.pts };
      if (spec.packets !== false && !(spec.journeys || []).length && PACKET[style]) packetLayer.push([gEl, g.d, g.len, style, -i * 0.7]);
    });
    const nodeEls = {};
    for (const n of nodes) {
      const gEl = el('g', { class: 'dn', 'data-id': n.id, 'data-step': firstStep[n.id] }, svg);
      el('rect', { class: `r-${n.role}`, x: r1(n.x), y: r1(n.y), width: r1(n.w), height: r1(n.h), rx: 10 }, gEl);
      let ty = n.y + 22;
      n.lines.forEach((l) => { text(gEl, r1(n.cx), r1(ty), l, `dlbl rt-${n.role}`); ty += 17; });
      if (n.sub) text(gEl, r1(n.cx), r1(ty - 1), n.sub, 'dsub');
      nodeEls[n.id] = { el: gEl, box: n };
    }
    // packets go on top of nodes so they stay visible while crossing a box
    for (const [gEl, d, len, style, begin] of packetLayer) gEl.appendChild(addPacket(svg, d, len, style, begin));
    const chain = (ids) => {
      let d = '', len = 0;
      for (let k = 0; k + 1 < ids.length; k++) {
        const e = edgeEls[`${ids[k]}>${ids[k + 1]}`];
        if (!e) continue;
        d += k === 0 ? e.d : ' ' + e.d.replace(/^M/, 'L');
        len += e.len;
      }
      return { d, len };
    };
    (spec.journeys || []).forEach((j, i) => {
      const { d, len } = chain(j.chain);
      if (d) addPacket(svg, d, len, j.style, -i * 0.9);
    });
    return { svg, nodes: nodeEls, edges: edgeEls, chain, addPacket: (d, len, style, begin = 0) => addPacket(svg, d, len, style, begin) };
  }

  // ------------------------------------------------------------------ sequence
  function sequence(spec, opts = {}) {
    const ps = spec.participants.map((p) => {
      const w = Math.max(90, Math.min(210, Math.max(measure(p.label, F.label), p.sub ? measure(p.sub, F.sub) : 0) + 30));
      return { ...p, w, h: p.sub ? 52 : 40 };
    });
    const idx = Object.fromEntries(ps.map((p, i) => [p.id, i]));
    const need = ps.map(() => 0);
    for (const m of spec.messages) {
      if (m.kind !== 'msg' || m.from === m.to) continue;
      const [i0, i1] = [Math.min(idx[m.from], idx[m.to]), Math.max(idx[m.from], idx[m.to])];
      const per = (measure(m.label, F.edge) + 34) / (i1 - i0);
      for (let i = i0 + 1; i <= i1; i++) need[i] = Math.max(need[i], per);
    }
    const M = 18;
    const cx = [M + ps[0].w / 2];
    for (let i = 1; i < ps.length; i++) cx[i] = cx[i - 1] + Math.max((ps[i - 1].w + ps[i].w) / 2 + 36, need[i]);
    const headH = Math.max(...ps.map((p) => p.h));
    let y = M + headH + 34;
    const rows = spec.messages.map((m) => {
      const r = { m, y };
      y += m.kind === 'note' ? 40 : m.from === m.to ? 54 : 42;
      return r;
    });
    const bottom = y - 6;
    let W = cx[cx.length - 1] + ps[ps.length - 1].w / 2 + M;
    const extra = Math.max(0, ...rows.filter((r) => r.m.kind === 'msg' && r.m.from === r.m.to).map((r) => cx[idx[r.m.from]] + 44 + measure(r.m.label, F.edge) - W + M));
    W += extra;
    // notes can stick out past the outer lifelines: grow the canvas to fit them
    const noteBox = (m) => {
      const a = cx[idx[m.from]], b = cx[idx[m.to]];
      const tw = measure(m.label, F.edge) + 20;
      return [Math.min(Math.min(a, b) - 46, (a + b) / 2 - tw / 2), Math.max(Math.max(a, b) + 46, (a + b) / 2 + tw / 2)];
    };
    const notes = spec.messages.filter((m) => m.kind === 'note').map(noteBox);
    let x0 = Math.min(0, ...notes.map((n) => n[0] - 8));
    let x1 = Math.max(W, ...notes.map((n) => n[1] + 8));
    const minW = opts.minWidth ?? 560;
    if (x1 - x0 < minW) { const pad = (minW - (x1 - x0)) / 2; x0 -= pad; x1 += pad; }
    const svg = el('svg', { viewBox: `${r1(x0)} 0 ${r1(x1 - x0)} ${r1(bottom + M)}`, role: 'img', class: 'dsl-svg' });
    svg.style.maxWidth = `${Math.round((x1 - x0) * 1.15)}px`;

    ps.forEach((p, i) => {
      el('line', { class: 'lifeline', x1: r1(cx[i]), y1: M + headH, x2: r1(cx[i]), y2: r1(bottom) }, svg);
      el('rect', { class: `r-${p.role}`, x: r1(cx[i] - p.w / 2), y: M + (headH - p.h), width: r1(p.w), height: p.h, rx: 10 }, svg);
      text(svg, r1(cx[i]), M + (headH - p.h) + 25, p.label, `dlbl rt-${p.role}`);
      if (p.sub) text(svg, r1(cx[i]), M + (headH - p.h) + 41, p.sub, 'dsub');
    });
    rows.forEach(({ m, y: yy }, k) => {
      const gEl = el('g', { 'data-step': spec.steps ? k + 1 : undefined }, svg);
      const a = cx[idx[m.from]], b = cx[idx[m.to]];
      if (m.kind === 'note') {
        const [nx0, nx1] = noteBox(m);
        el('rect', { class: 'r-note', x: r1(nx0), y: r1(yy - 14), width: r1(nx1 - nx0), height: 26, rx: 7 }, gEl);
        text(gEl, r1((a + b) / 2), r1(yy + 3), m.label, 'elbl');
        return;
      }
      const style = m.style || 'edge';
      if (m.from === m.to) {
        const d = `M${r1(a)} ${r1(yy - 8)} H${r1(a + 34)} V${r1(yy + 14)} H${r1(a + 3)}`;
        el('path', { class: EDGE_CLASS[style] || 'edge', d, 'marker-end': `url(#${MARKER[style] || 'arrow'})` }, gEl);
        text(gEl, r1(a + 42), r1(yy + 7), m.label, 'elbl', 'start');
        return;
      }
      const dir = b > a ? 1 : -1;
      const d = `M${r1(a + dir * 2)} ${r1(yy)} L${r1(b - dir * 3)} ${r1(yy)}`;
      el('path', { class: EDGE_CLASS[style] || 'edge', d, 'marker-end': `url(#${MARKER[style] || 'arrow'})` }, gEl);
      text(gEl, r1((a + b) / 2), r1(yy - 7), m.label, style === 'dim' ? 'elbl t-muted' : 'elbl');
    });
    return { svg };
  }

  function renderFigure(fig) {
    let spec;
    try { spec = JSON.parse(fig.querySelector('script[type="application/json"]').textContent); } catch (e) { console.error('bad diagram spec', e); return; }
    const res = spec.type === 'sequence' ? sequence(spec) : flow(spec);
    fig.insertBefore(res.svg, fig.querySelector('figcaption'));
    const steps = spec.type === 'sequence'
      ? (spec.steps ? spec.messages.map((m) => m.say || (m.kind === 'note' ? m.label : `${m.label}`)) : [])
      : (spec.steps || []).map((s) => s.text);
    if (steps.length) {
      fig.classList.add('stepper');
      const ol = document.createElement('ol');
      ol.className = 'steps';
      ol.innerHTML = steps.map((t) => `<li>${String(t || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('');
      fig.insertBefore(ol, fig.querySelector('figcaption'));
    }
  }

  window.DIAGRAM = {
    flow, sequence, measure,
    renderAll(root = document) {
      root.querySelectorAll('figure.dsl:not([data-drawn])').forEach((fig) => { fig.dataset.drawn = '1'; renderFigure(fig); });
    },
  };
})();
