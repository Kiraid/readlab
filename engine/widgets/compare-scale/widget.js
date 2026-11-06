// compare-scale: "one X per item" vs "one shared X for all items", with a slider for the item count
// and an editable unit cost. Two live SVG panels plus totals.
WIDGETS.register('compare-scale', {
  render(el, c, h) {
    const n0 = c.n?.default ?? 5, max = c.n?.max ?? 20, cost0 = c.cost?.default ?? 0;
    const unit = c.unit || 'unit', item = c.item || 'item', shared = c.shared || 'shared ' + unit;
    const money = (v) => (c.cost?.prefix ?? '$') + (Math.round(v * 100) / 100).toLocaleString() + (c.cost?.suffix ?? '');
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">compare</span><b>${h.esc(c.title || `One ${unit} per ${item}, or one for all?`)}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <div class="w-row"><span class="w-lbl">${h.esc(c.n?.label || item + 's')}</span><input type="range" min="1" max="${max}" value="${n0}"><b class="cs-n"></b>
        ${c.cost ? `<span class="w-lbl">${h.esc(c.cost.label || 'cost per ' + unit)}</span><input type="number" min="0" step="any" value="${cost0}">` : ''}</div>
      <div class="w-two">
        <div class="w-panel"><h5>${h.esc(c.left_title || `One ${unit} per ${item}`)}</h5><svg class="w-svg cs-a"></svg><div class="w-total cs-ta"></div></div>
        <div class="w-panel"><h5>${h.esc(c.right_title || `One ${shared}`)}</h5><svg class="w-svg cs-b"></svg><div class="w-total good cs-tb"></div></div>
      </div>
      ${c.note ? `<p class="w-sub">${h.md(c.note)}</p>` : ''}`;
    const range = el.querySelector('input[type=range]'), costIn = el.querySelector('input[type=number]');
    const SHOW = 8, RH = 30, W = 340;
    function draw() {
      const n = +range.value, cost = costIn ? +costIn.value || 0 : 0;
      el.querySelector('.cs-n').textContent = n;
      const rows = Math.min(n, SHOW);
      const H = rows * RH + 18 + (n > SHOW ? 18 : 0);
      for (const [sel, sharedMode] of [['.cs-a', false], ['.cs-b', true]]) {
        const svg = el.querySelector(sel);
        svg.innerHTML = '';
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        const ux = 238, uw = 92;
        for (let i = 0; i < rows; i++) {
          const y = 10 + i * RH;
          h.svgEl('rect', { class: 'r-service', x: 8, y, width: 96, height: 22, rx: 6 }, svg);
          const t = h.svgEl('text', { class: 'elbl rt-service', x: 56, y: y + 15, 'text-anchor': 'middle' }, svg);
          t.textContent = `${item} ${i + 1}`;
          const ty = sharedMode ? 10 + (rows * RH - 8) / 2 : y + 11;
          h.svgEl('path', { class: 'flow', d: `M${ux} ${ty} C ${ux - 60} ${ty}, ${164} ${y + 11}, ${104} ${y + 11}`, 'marker-end': 'url(#arrow-accent)' }, svg);
          if (!sharedMode) {
            h.svgEl('rect', { class: 'r-gateway', x: ux, y, width: uw, height: 22, rx: 6 }, svg);
            const u = h.svgEl('text', { class: 'elbl rt-gateway', x: ux + uw / 2, y: y + 15, 'text-anchor': 'middle' }, svg);
            u.textContent = unit;
          }
        }
        if (sharedMode) {
          const hh = Math.max(30, rows * RH - 8);
          h.svgEl('rect', { class: 'r-gateway', x: ux, y: 10, width: uw, height: hh, rx: 10 }, svg);
          const u = h.svgEl('text', { class: 'dlbl rt-gateway', x: ux + uw / 2, y: 10 + hh / 2 + 5, 'text-anchor': 'middle' }, svg);
          u.textContent = shared.length > 13 ? shared.slice(0, 12) + '…' : shared;
        }
        if (n > SHOW) { const m = h.svgEl('text', { class: 'cs-more', x: 8, y: H - 4 }, svg); m.textContent = `+ ${n - SHOW} more`; }
      }
      el.querySelector('.cs-ta').innerHTML = `${n} × ${h.esc(unit)}${c.cost ? ` = <b>${money(n * cost)}</b>` : ''}`;
      el.querySelector('.cs-tb').innerHTML = `1 × ${h.esc(shared)}${c.cost ? ` = <b>${money(cost)}</b>` : ''}`;
    }
    range.addEventListener('input', draw);
    if (costIn) costIn.addEventListener('input', draw);
    draw();
  },
});
