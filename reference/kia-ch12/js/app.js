// Page bootstrap: load section fragments, wire widgets, TOC, scroll spy, dock shell.
(function () {
  const SECTIONS = ['01-intro', '02-ingress-basics', '03-rules-tls', '04-config-classes'];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  let dockTerm;
  const APP = {
    toggleDock(force) {
      const d = $('#dock');
      const open = force === undefined ? !d.classList.contains('open') : force;
      d.classList.toggle('open', open);
      d.setAttribute('aria-hidden', String(!open));
      document.body.classList.toggle('dock-open', open);
      if (open) setTimeout(() => dockTerm.input.focus({ preventScroll: true }), 160);
    },
    runInDock(cmd) { APP.toggleDock(true); setTimeout(() => dockTerm.typeAndRun(cmd), 260); },
  };
  window.APP = APP;

  async function loadSections() {
    const main = $('#content');
    const htmls = await Promise.all(SECTIONS.map(async (s) => {
      try {
        const r = await fetch(`sections/${s}.html`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        return await r.text();
      } catch (e) {
        return `<section class="major pending"><h2><span class="num">…</span> Still being written</h2><p>The fragment <code>sections/${s}.html</code> isn't there yet. Reload in a minute.</p></section>`;
      }
    }));
    main.innerHTML = htmls.join('\n');
  }

  function buildTOC() {
    const nav = $('#toc');
    const secs = $$('#content section.major, #content section.sub');
    const visited = new Set(store.get('kia12-visited', []));
    nav.innerHTML = '<ol>' + secs.filter((s) => s.id).map((s) => {
      const h = $('h2, h3', s);
      const num = h && $('.num', h) ? $('.num', h).textContent : '';
      const title = h ? [...h.childNodes].filter((n) => !(n.classList && n.classList.contains('num'))).map((n) => n.textContent).join('').trim() : s.id;
      return `<li class="${s.classList.contains('major') ? 'maj' : 'sub'}${visited.has(s.id) ? ' visited' : ''}"><a href="#${s.id}" data-id="${s.id}"><span class="tn">${num}</span><span class="tt">${title}</span></a></li>`;
    }).join('') + '</ol>';
    const links = new Map($$('a', nav).map((a) => [a.dataset.id, a]));
    const obs = new IntersectionObserver((ents) => {
      ents.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.classList.remove('active'));
        const a = links.get(en.target.id);
        if (!a) return;
        a.classList.add('active');
        a.parentElement.classList.add('visited');
        visited.add(en.target.id);
        store.set('kia12-visited', [...visited]);
        const r = a.getBoundingClientRect(), nr = nav.getBoundingClientRect();
        if (r.top < nr.top || r.bottom > nr.bottom) a.scrollIntoView({ block: 'nearest' });
      });
    }, { rootMargin: '-15% 0px -75% 0px' });
    secs.forEach((s) => obs.observe(s));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('toc-open'); });
  }

  function progress() {
    const bar = $('#progress');
    const upd = () => { const h = document.documentElement; bar.style.width = (100 * h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) + '%'; };
    document.addEventListener('scroll', upd, { passive: true });
    upd();
  }

  function quizScore() {
    const total = $$('.quiz').length;
    const el = $('#quiz-score');
    if (!el) return;
    const upd = () => { const n = $$('.quiz.solved').length; el.textContent = `✓ ${n} / ${total} quizzes`; el.classList.toggle('all', n === total && total > 0); };
    document.addEventListener('quiz:solved', upd);
    upd();
  }

  function dock() {
    dockTerm = new Term($('#dock .dock-term'), { greeting: '# drop-down shell: same simulated cluster as every inline terminal. Esc or ` to close.' });
    $('#dock-fab').onclick = () => APP.toggleDock();
    $('#dock-close').onclick = () => APP.toggleDock(false);
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === '`' && (!inField || $('#dock').contains(t))) { e.preventDefault(); APP.toggleDock(); }
      else if (e.key === 'Escape' && $('#dock').classList.contains('open')) { APP.toggleDock(false); }
    });
  }

  async function main() {
    await loadSections();
    // ?only=s12-2,s12-3 renders just those sections (prefix match); handy for screenshots.
    const only = new URLSearchParams(location.search).get('only');
    if (only) {
      const ids = only.split(',');
      $$('#content > section').forEach((s) => { if (!ids.some((id) => s.id === id || s.id.startsWith(id + '-'))) s.remove(); });
      $('.hero').remove();
    }
    WIDGETS.init($('#content'));
    buildTOC();
    progress();
    dock();
    quizScore();
    WIDGETS.hud($('#hud'));
    $('#toc-toggle').onclick = () => document.body.classList.toggle('toc-open');
    $('#reset-all').onclick = () => {
      try { localStorage.removeItem('kia12-state-v1'); localStorage.removeItem('kia12-visited'); } catch (e) { /* ignore */ }
      location.reload();
    };
    if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(() => t.scrollIntoView(), 50); }
  }
  main();
})();
