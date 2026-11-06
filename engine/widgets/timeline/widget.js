// timeline: lanes over time (a Gantt chart). Scrub or play a playhead; bars light up while active and the
// narration for the current moment appears below. Scheduling, transaction interleaving, rolling updates.
WIDGETS.register('timeline', {
  render(el, c, h) {
    const lanes = c.lanes || [];
    const events = c.events || [];
    const marks = c.marks || [];
    const end = c.end ?? Math.max(1, ...events.map((e) => e.end), ...marks.map((m) => m.at));
    const unit = c.unit || '';
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">timeline</span><b>${h.esc(c.title || 'Timeline')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <svg class="w-svg tl-svg"></svg>
      <div class="w-row"><button class="w-btn tl-play">▶ play</button><input type="range" min="0" max="${end}" step="${c.step || end / 100}" value="0"><b class="tl-t"></b></div>
      <div class="w-out tl-say"></div>
      ${c.summary ? `<p class="w-sub">${h.md(c.summary)}</p>` : ''}`;
    const svg = el.querySelector('svg');
    const LW = 110, W = 720, LH = 34, top = marks.length ? 24 : 10;
    const x = (t) => LW + (t / end) * (W - LW - 14);
    const H = top + lanes.length * LH + 30;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    lanes.forEach((ln, i) => {
      const t = h.svgEl('text', { class: 'tl-lane', x: LW - 10, y: top + i * LH + 21 }, svg);
      t.textContent = ln.label || ln.id;
      h.svgEl('line', { class: 'tl-axis', x1: LW, x2: W - 14, y1: top + (i + 1) * LH - 2, y2: top + (i + 1) * LH - 2, opacity: 0.4 }, svg);
    });
    const ticks = c.ticks || Math.min(12, end);
    for (let k = 0; k <= ticks; k++) {
      const t = (end * k) / ticks;
      const tx = h.svgEl('text', { class: 'tl-tick', x: x(t), y: H - 8 }, svg);
      tx.textContent = (Math.round(t * 10) / 10) + (k === ticks ? unit : '');
    }
    const laneIdx = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
    const bars = events.map((e) => {
      const y = top + (laneIdx[e.lane] ?? 0) * LH + 4;
      const g = h.svgEl('g', {}, svg);
      const r = h.svgEl('rect', { class: `tl-bar r-${e.role || 'process'}`, x: x(e.start), y, width: Math.max(4, x(e.end) - x(e.start)), height: LH - 10, rx: 6 }, g);
      if (x(e.end) - x(e.start) > 34) {
        const t = h.svgEl('text', { class: `elbl rt-${e.role || 'process'}`, x: (x(e.start) + x(e.end)) / 2, y: y + 16, 'text-anchor': 'middle' }, g);
        t.textContent = e.label || '';
      }
      return { e, r };
    });
    marks.forEach((m) => {
      h.svgEl('line', { class: 'tl-mark', x1: x(m.at), x2: x(m.at), y1: top, y2: top + lanes.length * LH }, svg);
      const t = h.svgEl('text', { class: 'tl-tick', x: x(m.at), y: top - 8 }, svg);
      t.textContent = m.label || '';
    });
    const head = h.svgEl('line', { class: 'tl-head', y1: top - 4, y2: top + lanes.length * LH }, svg);
    const range = el.querySelector('input[type=range]');
    function at(t) {
      head.setAttribute('x1', x(t)); head.setAttribute('x2', x(t));
      el.querySelector('.tl-t').textContent = `${Math.round(t * 10) / 10}${unit}`;
      bars.forEach(({ e, r }) => { r.classList.toggle('future', t < e.start); r.classList.toggle('active', t >= e.start && t < e.end); });
      const active = bars.filter(({ e }) => t >= e.start && t < e.end).map(({ e }) => e);
      const past = [...events.filter((e) => e.start <= t && e.say), ...marks.filter((m) => m.at <= t && m.say)]
        .sort((a, b) => (a.start ?? a.at) - (b.start ?? b.at));
      const lastSay = past[past.length - 1];
      el.querySelector('.tl-say').innerHTML = (active.length ? `<b>now:</b> ${active.map((e) => `${h.esc((lanes[laneIdx[e.lane]] || {}).label || e.lane)} → ${h.esc(e.label || '')}`).join(' · ')}` : '<b>now:</b> idle') +
        (lastSay ? `<br>${h.md(lastSay.say)}` : '');
    }
    let timer = null;
    const play = el.querySelector('.tl-play');
    const stop = () => { clearInterval(timer); timer = null; play.textContent = '▶ play'; };
    play.addEventListener('click', () => {
      if (timer) return stop();
      if (+range.value >= end) range.value = 0;
      play.textContent = '❚❚ pause';
      const dt = end / ((c.seconds || 8) * 25);
      timer = setInterval(() => { const v = Math.min(end, +range.value + dt); range.value = v; at(v); if (v >= end) stop(); }, 40);
    });
    range.addEventListener('input', () => { stop(); at(+range.value); });
    at(0);
  },
});
