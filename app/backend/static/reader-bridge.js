// Injected into every chapter page the app serves. Inside the app's reader (an iframe) it hides the page's own
// sidebar (the app shows the contents), reports where the reader is, scrolls back to a saved place, hands links to
// sections that are not loaded to the app, and appends the next part when the reader nears the end (infinite
// scroll: every part shares the chapter's scripts, so its sections slot into this page). Opened on its own, the
// page is left alone.
(function () {
  if (window.parent === window) return;
  const origin = location.origin;
  const post = (msg) => window.parent.postMessage({ source: 'readlab-page', ...msg }, origin);
  document.documentElement.classList.add('rl-embedded');
  const style = document.createElement('style');
  style.textContent = `
    .rl-embedded #side, .rl-embedded #toc-toggle, .rl-embedded #progress { display: none !important; }
    .rl-embedded .layout { grid-template-columns: minmax(0, 1fr) !important; }
    .rl-embedded main { padding-top: 8px; }
    .rl-embedded .hero[hidden] { display: none; }
    .rl-part + .rl-part { margin-top: 24px; }
    .rl-more { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 36px 0; color: #8e9ab0; font: 13px 'JetBrains Mono', monospace; }
    .rl-more::before { content: ''; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #2f3c57; border-top-color: #ff9159; animation: rl-spin .8s linear infinite; }
    @keyframes rl-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);

  const content = document.getElementById('content');
  const LINE = 0.3;  // the reading line, from the top of the viewport
  const first = Number((location.pathname.match(/parts\/(\d+)\.html$/) || [])[1] || 1);
  const parts = () => [...document.querySelectorAll('.rl-part')];
  if (content) {  // this page's own sections become the first part
    const wrap = document.createElement('div');
    wrap.className = 'rl-part';
    wrap.dataset.part = String(first);
    while (content.firstChild) wrap.appendChild(content.firstChild);
    content.appendChild(wrap);
  }
  const top = (el) => el.getBoundingClientRect().top + window.scrollY;

  function where() {
    const h = document.documentElement;
    const line = window.scrollY + h.clientHeight * LINE;
    const ps = parts();
    let p = ps[0];
    for (const x of ps) if (top(x) <= line) p = x;
    if (!p) return { part: first, offset: Math.min(1, h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)), anchor: '' };
    let offset = Math.max(0, Math.min(1, (line - top(p)) / Math.max(1, p.offsetHeight)));
    const atBottom = window.scrollY + h.clientHeight >= h.scrollHeight - 2;
    if (atBottom && p === ps[ps.length - 1] && !more) offset = 1;
    let anchor = '';
    for (const s of p.querySelectorAll('section.major[id], section.sub[id]')) {
      if (top(s) <= line) anchor = s.id; else break;
    }
    if (!anchor) anchor = (p.querySelector('section[id]') || {}).id || '';
    return { part: Number(p.dataset.part), offset, anchor };
  }

  let more = true;     // the app says when there is nothing left to append
  let loading = false;
  function nearEnd() {
    const h = document.documentElement;
    if (!more || loading || !content) return;
    if (window.scrollY + h.clientHeight * 2.5 >= h.scrollHeight) {
      loading = true;
      const last = parts().pop();
      post({ type: 'need-more', after: Number(last ? last.dataset.part : first) });
    }
  }

  async function append(n, url) {
    const holder = document.createElement('div');
    holder.className = 'rl-more';
    holder.textContent = `Loading part ${n}`;
    content.appendChild(holder);
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const wrap = document.createElement('div');
      wrap.className = 'rl-part';
      wrap.dataset.part = String(n);
      const src = doc.getElementById('content');
      if (src) while (src.firstChild) wrap.appendChild(document.adoptNode(src.firstChild));
      holder.replaceWith(wrap);
      const foot = doc.querySelector('.foot p');
      const ours = document.querySelector('.foot p');
      if (foot && ours && foot.textContent.trim()) ours.innerHTML = foot.innerHTML;  // the last part carries the footer
      if (window.WIDGETS) window.WIDGETS.init(wrap);
      post({ type: 'appended', part: n });
    } catch (e) {
      holder.remove();
      more = false;  // fall back to the app's pager
      post({ type: 'append-failed', part: n });
    }
    loading = false;
    report();
  }

  let timer = 0;
  const report = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { post({ type: 'position', ...where() }); nearEnd(); }, 200);
  };
  document.addEventListener('scroll', report, { passive: true });

  function settle() {  // diagrams and widgets size themselves after the fonts load
    const fonts = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
    return Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => new Promise((r) => setTimeout(r, 150)));
  }

  function scrollToPart(n, offset) {
    const p = document.querySelector(`.rl-part[data-part="${n}"]`);
    if (!p) return false;
    const y = top(p) + offset * p.offsetHeight - (offset > 0 ? document.documentElement.clientHeight * LINE : 16);
    // instant: the pages ask for smooth scrolling, which would report the place before the jump lands
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    return true;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== origin || !e.data || e.data.source !== 'readlab-app') return;
    const d = e.data;
    if (d.type === 'restore') {
      settle().then(() => {
        const el = d.anchor && document.getElementById(d.anchor);
        if (d.offset > 0) scrollToPart(d.part || first, d.offset);
        else if (el) el.scrollIntoView({ behavior: 'instant' });
        post({ type: 'restored', ...where() });
        nearEnd();
      });
    } else if (d.type === 'goto') {
      const el = d.anchor && document.getElementById(d.anchor);
      if (el) el.scrollIntoView({ behavior: d.smooth ? 'smooth' : 'auto' });
      else if (d.part) scrollToPart(d.part, 0);
    } else if (d.type === 'append' && d.url) {
      append(d.part, d.url);
    } else if (d.type === 'no-more') {
      more = false;
      loading = false;
    }
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (id && !document.getElementById(id)) { e.preventDefault(); post({ type: 'link', anchor: id }); }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); post({ type: 'key', key: 'search' }); }
    else if (!inField && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); post({ type: 'key', key: e.key === 'ArrowRight' ? 'next' : 'prev' }); }
  });

  window.addEventListener('load', () => settle().then(() => post({ type: 'ready', ...where() })));
})();
