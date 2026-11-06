// rule-tester: type an input (a path, a host, an IP, a file name...) and see which rules match and why.
// Policy picks the winner: first match in order, the longest pattern, or show all matches.
WIDGETS.register('rule-tester', {
  render(el, c, h) {
    const rules = c.rules || [];
    const policy = c.pick || 'first';
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">lab</span><b>${h.esc(c.title || 'Which rule matches?')}</b>
        <span class="w-sub">${policy === 'first' ? 'first matching rule wins' : policy === 'longest' ? 'the most specific match wins' : 'every matching rule applies'}</span></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <label class="w-field"><span class="w-lbl">${h.esc(c.input_label || 'input')}</span><input class="rt-in" value="${h.esc((c.presets || [''])[0])}" placeholder="${h.esc(c.placeholder || '')}"></label>
      ${(c.presets || []).length ? `<div class="w-presets"><span class="w-lbl">try</span>${c.presets.map((p) => `<button data-v="${h.esc(p)}">${h.esc(p)}</button>`).join('')}</div>` : ''}
      <table class="w-table"><thead><tr><th>rule</th><th>type</th><th>match?</th><th>why</th></tr></thead><tbody></tbody></table>
      <div class="w-out rt-res"></div>`;
    const input = el.querySelector('.rt-in');
    function run() {
      const v = input.value.trim();
      const res = rules.map((r) => ({ r, ...(h.MATCH[r.kind] || h.MATCH.exact)(v, r.pattern) }));
      const hits = res.filter((x) => x.ok);
      let win = [];
      if (policy === 'first') win = hits.slice(0, 1);
      else if (policy === 'longest') win = hits.length ? [hits.reduce((a, b) => (String(b.r.pattern).length > String(a.r.pattern).length ? b : a))] : [];
      else win = hits;
      el.querySelector('tbody').innerHTML = res.map((x) => `<tr class="${win.includes(x) ? 'win' : ''}">
        <td><code>${h.esc(x.r.pattern)}</code>${x.r.label ? `<br><small>${h.esc(x.r.label)}</small>` : ''}</td><td>${h.esc(x.r.kind)}</td>
        <td class="${x.ok ? 'v-ok' : 'v-no'}">${x.ok ? '✓' : '✗'}</td><td>${h.esc(x.why)}${x.ok && c.notes && c.notes[x.r.kind] ? `<br><small>${h.md(c.notes[x.r.kind])}</small>` : ''}</td></tr>`).join('');
      const out = el.querySelector('.rt-res');
      if (!win.length) out.innerHTML = `<span class="bad">No rule matches.</span> ${h.md(c.no_match || '')}`;
      else out.innerHTML = win.map((x) => `<span class="ok">→ ${h.esc(x.r.target || x.r.label || x.r.pattern)}</span>`).join('<br>') +
        (policy === 'longest' && hits.length > 1 ? `<br><small>${hits.length} rules match; the longest pattern wins.</small>` : '');
    }
    input.addEventListener('input', run);
    el.querySelectorAll('.w-presets button').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.v; run(); }));
    run();
  },
});
