// request-tracer: build a request from a few fields, send it, and watch it travel the path the
// first matching route picks (a packet animates along the diagram), with the reason it went there.
WIDGETS.register('request-tracer', {
  render(el, c, h) {
    const fields = c.fields || [];
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">playground</span><b>${h.esc(c.title || 'Where does this request go?')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <div class="w-row">${fields.map((f, i) => `<label class="w-field" style="flex:1 1 140px"><span class="w-lbl">${h.esc(f.label || f.name)}</span>${f.options
        ? `<select data-i="${i}">${f.options.map((o) => `<option${o === f.default ? ' selected' : ''}>${h.esc(o)}</option>`).join('')}</select>`
        : `<input data-i="${i}" value="${h.esc(f.default ?? '')}">`}</label>`).join('')}
        <button class="w-btn rt-send">send ▶</button></div>
      ${(c.presets || []).length ? `<div class="w-presets"><span class="w-lbl">try</span>${c.presets.map((p, i) => `<button data-p="${i}">${h.esc(p.label || Object.values(p.values || {}).join(' '))}</button>`).join('')}</div>` : ''}
      <div class="rt-dia"></div>
      <div class="w-out rt-why"></div>`;
    const dia = DIAGRAM.flow(Object.assign({}, c.diagram, { packets: false, journeys: [] }), { minWidth: 520 });
    dia.svg.classList.add('w-svg');
    el.querySelector('.rt-dia').appendChild(dia.svg);
    const inputs = [...el.querySelectorAll('[data-i]')];
    const values = () => Object.fromEntries(fields.map((f, i) => [f.name, inputs[i].value.trim()]));
    const chainOf = (via) => String(via).split('>').map((s) => s.trim()).filter(Boolean);
    let packet = null;

    function pick(v) {
      for (const r of c.routes || []) {
        const checks = Object.entries(r.when || {}).map(([k, spec]) => ({ k, ...h.matchSpec(v[k] ?? '', spec) }));
        if (checks.every((x) => x.ok)) return { r, checks };
      }
      return { r: c.fallback || null, checks: [] };
    }
    function send() {
      const v = values();
      const { r, checks } = pick(v);
      const chain = r ? chainOf(r.via) : [];
      const onPath = new Set(chain);
      const pathEdges = new Set(chain.slice(1).map((id, k) => `${chain[k]}>${id}`));
      Object.entries(dia.nodes).forEach(([id, n]) => { n.el.classList.toggle('dimmed', chain.length > 0 && !onPath.has(id)); n.el.classList.toggle('now', id === chain[chain.length - 1]); });
      Object.entries(dia.edges).forEach(([id, e]) => { e.el.classList.toggle('dimmed', !pathEdges.has(id)); e.el.classList.toggle('lit', pathEdges.has(id)); });
      if (packet) packet.remove();
      const { d, len } = dia.chain(chain);
      if (d) {
        packet = h.svgEl('circle', { class: r && r.error ? 'packet-bad' : 'packet', r: 5.5 }, dia.svg);
        const a = h.svgEl('animateMotion', { dur: `${Math.max(0.9, len / 260).toFixed(2)}s`, repeatCount: 1, fill: 'freeze', begin: 'indefinite', path: d }, packet);
        try { a.beginElement(); } catch (e) { /* older browsers: packet stays at start */ }
      }
      const why = el.querySelector('.rt-why');
      if (!r) { why.innerHTML = `<span class="bad">No route matches and there is no fallback.</span>`; return; }
      why.innerHTML = `<b class="${r.error ? 'bad' : 'ok'}">${h.esc(r.result || chain[chain.length - 1] || '')}</b>` +
        (checks.length ? `<br><small>${checks.map((x) => `${h.esc(x.k)}: ${h.esc(x.why)}`).join(' · ')}</small>` : '') +
        (r.why ? `<br>${h.md(r.why)}` : '');
    }
    el.querySelector('.rt-send').addEventListener('click', send);
    inputs.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); }));
    el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = c.presets[+b.dataset.p];
      fields.forEach((f, i) => { if (p.values && f.name in p.values) inputs[i].value = p.values[f.name]; });
      send();
    }));
    send();
  },
});
