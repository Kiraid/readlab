// toggle-compare: two to four alternatives of the same thing; each option shows its own diagram and the
// points that change. Same layout positions in every option make the difference jump out.
WIDGETS.register('toggle-compare', {
  render(el, c, h) {
    const opts = c.options || [];
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">compare</span><b>${h.esc(c.title || 'Compare')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <div class="w-seg">${opts.map((o, i) => `<button data-i="${i}">${h.esc(o.label)}</button>`).join('')}</div>
      <div class="tc-body"></div>`;
    const body = el.querySelector('.tc-body');
    function show(i) {
      el.querySelectorAll('.w-seg button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
      const o = opts[i];
      body.innerHTML = '';
      if (o.diagram) {
        const d = DIAGRAM.flow(o.diagram, { minWidth: 520 });
        d.svg.classList.add('w-svg');
        body.appendChild(d.svg);
      }
      const out = document.createElement('div');
      out.className = 'w-out';
      out.innerHTML = (o.summary ? `<p style="margin:0 0 6px">${h.md(o.summary)}</p>` : '') +
        (o.points || []).map((p) => `<div>• ${h.md(p)}</div>`).join('');
      body.appendChild(out);
    }
    el.querySelectorAll('.w-seg button').forEach((b) => b.addEventListener('click', () => show(+b.dataset.i)));
    show(0);
  },
});
