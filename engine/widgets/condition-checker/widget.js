// condition-checker: pick a few settings and see which conditions pass, with the reason for each, plus
// an overall verdict. Declarative: each check passes when every listed input has one of the allowed values.
WIDGETS.register('condition-checker', {
  render(el, c, h) {
    const inputs = c.inputs || [];
    const state = Object.fromEntries(inputs.map((i) => [i.id, i.default ?? i.options[0]]));
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">lab</span><b>${h.esc(c.title || 'What has to be true?')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      ${inputs.map((i) => `<div class="w-row"><span class="w-lbl" style="min-width:150px">${h.esc(i.label || i.id)}</span>
        <span class="w-seg" data-id="${h.esc(i.id)}">${i.options.map((o) => `<button data-v="${h.esc(o)}">${h.esc(o)}</button>`).join('')}</span></div>`).join('')}
      <div class="w-out"><ul class="w-checks"></ul><div class="w-verdict"></div></div>`;
    const ok = (check) => Object.entries(check.pass_if || {}).every(([k, allowed]) => [].concat(allowed).map(String).includes(String(state[k])));
    function render() {
      el.querySelectorAll('.w-seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === String(state[seg.dataset.id]))));
      const res = (c.checks || []).map((ch) => ({ ch, pass: ok(ch) }));
      el.querySelector('.w-checks').innerHTML = res.map(({ ch, pass }) => `<li class="${pass ? 'pass' : 'fail'}"><span class="mark">${pass ? '✓' : '✗'}</span>
        <div><b>${h.esc(ch.label)}</b><small>${h.md(pass ? ch.pass || '' : ch.fail || '')}</small></div></li>`).join('');
      const all = res.every((r) => r.pass);
      const v = el.querySelector('.w-verdict');
      v.className = 'w-verdict ' + (all ? 'pass' : 'fail');
      v.innerHTML = h.md(all ? c.verdict?.pass || 'All conditions hold.' : c.verdict?.fail || 'At least one condition fails.');
    }
    el.querySelectorAll('.w-seg').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state[seg.dataset.id] = b.dataset.v; render();
    }));
    render();
  },
});
