// matrix-explorer: a rows × columns grid (e.g. release channel × support level, isolation level ×
// anomaly). Items sit in cells as chips; clicking one highlights its cell and shows the details.
WIDGETS.register('matrix-explorer', {
  render(el, c, h) {
    const rows = c.rows || [], cols = c.cols || [], items = c.items || [];
    const key = (r, k) => `${r}/${k}`;
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">explore</span><b>${h.esc(c.title || 'Explore')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <div class="w-grid-m" style="grid-template-columns: minmax(90px,auto) repeat(${cols.length}, minmax(0,1fr))">
        <span></span>${cols.map((k) => `<span class="hd">${h.esc(k.label || k.id)}</span>`).join('')}
        ${rows.map((r) => `<span class="hd" style="align-self:center">${h.esc(r.label || r.id)}</span>` + cols.map((k) =>
          `<div class="cell" data-k="${h.esc(key(r.id, k.id))}" title="${h.esc((c.cells || {})[key(r.id, k.id)] || '')}">${items.map((it, i) =>
            it.row === r.id && it.col === k.id ? `<button class="w-chip" data-i="${i}">${h.esc(it.label)}</button>` : '').join('')}</div>`).join('')).join('')}
      </div>
      <div class="w-out w-detail"></div>`;
    const detail = el.querySelector('.w-detail');
    function show(i) {
      const it = items[i];
      el.querySelectorAll('.w-chip').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
      el.querySelectorAll('.cell').forEach((cell) => cell.classList.toggle('sel', cell.dataset.k === key(it.row, it.col)));
      const cellText = (c.cells || {})[key(it.row, it.col)];
      detail.innerHTML = `<b>${h.esc(it.label)}</b>${it.text ? `<p style="margin:6px 0">${h.md(it.text)}</p>` : ''}` +
        (it.code ? `<pre class="w-code">${h.esc(it.code)}</pre>` : '') + (cellText ? `<small>${h.md(cellText)}</small>` : '');
    }
    el.querySelectorAll('.w-chip').forEach((b) => b.addEventListener('click', () => show(+b.dataset.i)));
    if (items.length) show(0); else detail.remove();
  },
});
