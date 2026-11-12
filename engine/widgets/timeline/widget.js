// timeline: lanes over time (a Gantt chart). Scrub or play a playhead; bars light up while active and the
// narration for the current moment appears below. Scheduling, transaction interleaving, rolling updates.
WIDGETS.register('timeline', {
  render(el, c, h) {
    const lanes = c.lanes || [];
    const events = c.events || [];
    const marks = c.marks || [];
    // `end` can stretch the axis past the last event, never cut it short (a writer once gave end: 12 for events to 600)
    const end = Math.max(c.end ?? 0, 1, ...events.map((e) => e.end), ...marks.map((m) => m.at));
    // the axis starts at 0 unless the first event is far from it (years: 1975-2015 would be squeezed against the
    // right edge of a 0-2015 axis); then it starts at the first event, rounded down to a tick
    const first = Math.min(end, ...events.map((e) => e.start), ...marks.map((m) => m.at));
    const niceStep = (span) => { const p = 10 ** Math.floor(Math.log10(span / 12)); return [1, 2, 5, 10].map((m) => m * p).find((s) => span / s <= 12); };
    const s0 = c.start ?? (first > 0.3 * end ? Math.floor(first / niceStep(end - first)) * niceStep(end - first) : 0);
    const unit = /^[a-z]{3,}/i.test(c.unit || '') ? ` ${c.unit}` : c.unit || ''; // "4 step", but "4s", "4ms"
    el.innerHTML = `
      <div class="w-head"><span class="w-tag">timeline</span><b>${h.esc(c.title || 'Timeline')}</b></div>
      ${c.intro ? `<p class="w-sub">${h.md(c.intro)}</p>` : ''}
      <svg class="w-svg tl-svg"></svg>
      <div class="w-row"><button class="w-btn tl-play">▶ play</button><input type="range" min="${s0}" max="${end}" step="${c.step || (end - s0) / 100}" value="${s0}"><b class="tl-t"></b></div>
      <div class="w-out tl-say"></div>
      ${c.summary || c.caption ? `<p class="w-sub">${h.md(c.summary || c.caption)}</p>` : ''}`;
    const svg = el.querySelector('svg');
    // the label column fits the longest lane label (about 7px a character), within 70-210px
    const LW = Math.max(70, Math.min(210, 16 + 7 * Math.max(0, ...lanes.map((l) => String(l.label || l.id).length)))), W = 720, LH = 34, top = marks.length ? 24 : 10;
    const x = (t) => LW + ((t - s0) / (end - s0)) * (W - LW - 14);
    const H = top + lanes.length * LH + 30;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    lanes.forEach((ln, i) => {
      const t = h.svgEl('text', { class: 'tl-lane', x: LW - 10, y: top + i * LH + 21 }, svg);
      t.textContent = ln.label || ln.id;
      h.svgEl('line', { class: 'tl-axis', x1: LW, x2: W - 14, y1: top + (i + 1) * LH - 2, y2: top + (i + 1) * LH - 2, opacity: 0.4 }, svg);
    });
    // ticks on round numbers (0, 10, 20 … not 8.3, 16.7 …): the smallest 1/2/5 × 10^k step giving at most 12,
    // or `ticks` equal parts when the config asks; the last tick is always `end`, with the unit
    const whole = [...events.flatMap((e) => [e.start, e.end]), ...marks.map((m) => m.at)].every(Number.isInteger);
    const stepT = c.ticks ? (end - s0) / c.ticks : Math.max(whole ? 1 : 0, niceStep(end - s0));  // whole steps: no 0.5
    const tickAt = [];
    for (let t = s0; t < end - stepT * 0.6; t += stepT) tickAt.push(t);  // no tick crowding the end label
    tickAt.push(end);
    tickAt.forEach((t, k) => {
      const last = k === tickAt.length - 1;
      const tx = h.svgEl('text', { class: 'tl-tick', x: x(t), y: H - 8 }, svg);
      tx.textContent = (Math.round(t * 100) / 100) + (last ? unit : '');
      if (last) tx.style.textAnchor = 'end';  // "120 seconds" ends at the axis instead of running off it
    });
    const laneIdx = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
    const bars = events.map((e) => {
      const y = top + (laneIdx[e.lane] ?? 0) * LH + 4;
      const g = h.svgEl('g', {}, svg);
      const r = h.svgEl('rect', { class: `tl-bar r-${e.role || 'process'}`, x: x(e.start), y, width: Math.max(4, x(e.end) - x(e.start)), height: LH - 10, rx: 6 }, g);
      const fit = Math.floor((x(e.end) - x(e.start) - 8) / 6.5);  // characters that fit inside the bar
      if (e.label && fit >= 3) {
        const t = h.svgEl('text', { class: `elbl rt-${e.role || 'process'}`, x: (x(e.start) + x(e.end)) / 2, y: y + 16, 'text-anchor': 'middle' }, g);
        t.textContent = e.label.length > fit ? `${e.label.slice(0, fit - 1)}…` : e.label;
      }
      if (e.label) h.svgEl('title', {}, g).textContent = e.label;  // the full label on hover
      return { e, r };
    });
    marks.forEach((m) => {
      h.svgEl('line', { class: 'tl-mark', x1: x(m.at), x2: x(m.at), y1: top, y2: top + lanes.length * LH }, svg);
      const t = h.svgEl('text', { class: 'tl-tick', x: x(m.at), y: top - 8 }, svg);
      t.textContent = m.label || '';
      // near an edge, end (or start) the label at the mark instead of centring it; a style, since the
      // stylesheet's text-anchor would win over an attribute
      if (x(m.at) > W - 120) t.style.textAnchor = 'end';
      else if (x(m.at) < LW + 60) t.style.textAnchor = 'start';
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
    // The time lives in `cur`, not in the slider: a range input snaps its value to `step`, so reading the next
    // tick back from it (each tick is smaller than a step) can round down to where it was and stall playback.
    let timer = null;
    let cur = s0;
    const play = el.querySelector('.tl-play');
    const stop = () => { clearInterval(timer); timer = null; play.textContent = '▶ play'; };
    play.addEventListener('click', () => {
      if (timer) return stop();
      if (cur >= end) cur = s0;
      play.textContent = '❚❚ pause';
      const dt = (end - s0) / ((c.seconds || 8) * 25);
      timer = setInterval(() => { cur = Math.min(end, cur + dt); range.value = cur; at(cur); if (cur >= end) stop(); }, 40);
    });
    range.addEventListener('input', () => { stop(); cur = +range.value; at(cur); });
    at(s0);
  },
});
