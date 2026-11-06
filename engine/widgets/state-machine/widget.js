// state-machine: the states and transitions are a flow diagram; the reader stands in one state and
// clicks the transitions that leave it (fork, schedule, block on I/O...). The path so far is logged.
WIDGETS.register('state-machine', {
  render(el, c, h) {
    const dia = DIAGRAM.flow(Object.assign({}, c.diagram, { packets: false, journeys: [] }), { minWidth: 520 });
    dia.svg.classList.add('w-svg');
    const edges = c.diagram.edges || [];
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">state machine</span><b>${h.esc(c.title || 'Walk the states')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <div class="sm-dia"></div>
      <div class="w-row"><span class="w-lbl">from here</span><span class="w-seg sm-next"></span><button class="w-btn ghost sm-reset">reset</button></div>
      <div class="w-out sm-say"></div>
      <div class="w-log"></div>`;
    el.querySelector('.sm-dia').appendChild(dia.svg);
    const start = c.start || (c.diagram.nodes[0] && c.diagram.nodes[0].id);
    let cur = start, path = [start], last = null;
    const label = (id) => (c.diagram.nodes.find((n) => n.id === id) || {}).label || id;
    function render() {
      Object.entries(dia.nodes).forEach(([id, n]) => n.el.classList.toggle('now', id === cur));
      Object.entries(dia.edges).forEach(([id, e]) => { const out = id.startsWith(cur + '>'); e.el.classList.toggle('lit', out); e.el.classList.toggle('dimmed', !out); });
      const outs = edges.filter((e) => e.from === cur);
      el.querySelector('.sm-next').innerHTML = outs.length
        ? outs.map((e) => `<button data-id="${h.esc(e.id)}">${h.esc(e.label || '→ ' + label(e.to))}</button>`).join('')
        : '<span class="w-sub">no way out: a final state</span>';
      const say = el.querySelector('.sm-say');
      const stateNote = (c.notes || {})[cur];
      const edgeNote = last && (c.notes || {})[last.id];
      say.innerHTML = `<b>${h.esc(label(cur))}</b>` + (edgeNote ? `<br>${h.md(edgeNote)}` : '') + (stateNote ? `<br>${h.md(stateNote)}` : '');
      el.querySelector('.w-log').innerHTML = path.map((id, i) => (i === path.length - 1 ? `<b>${h.esc(label(id))}</b>` : h.esc(label(id)))).join(' → ');
    }
    el.querySelector('.sm-next').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      last = edges.find((x) => x.id === b.dataset.id);
      cur = last.to; path.push(cur);
      if (path.length > 14) path = ['…', ...path.slice(-12)];
      render();
    });
    el.querySelector('.sm-reset').addEventListener('click', () => { cur = start; path = [start]; last = null; render(); });
    render();
  },
});
