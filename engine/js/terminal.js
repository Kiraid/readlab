// Terminal widget. Every instance talks to the same window.SIM (the chapter's shell plugin),
// so state is shared across the page. Prompt and title come from window.CHAPTER.shell.
// Canned outputs (window.CANNED, from :::term blocks) answer exact command lines first.
(function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const SHELL = Object.assign({ user: 'you@book', dir: '~' }, (window.CHAPTER && window.CHAPTER.shell) || {});
  const PS1 = `<span class="ps1"><span class="ps-u">${esc(SHELL.user)}</span>:<span class="ps-d">${esc(SHELL.dir)}</span>$</span>`;

  // YAML highlighter shared with code blocks.
  function hlYAMLLine(line) {
    const ci = (() => { let q = null; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i; } return -1; })();
    const code = ci >= 0 ? line.slice(0, ci) : line;
    const com = ci >= 0 ? line.slice(ci) : '';
    let html;
    const m = code.match(/^(\s*)(- )?([A-Za-z0-9_.\/-]+|"[^"]*")(:)(\s*)(.*)$/);
    if (m && !/^\s*- --/.test(code)) {
      html = esc(m[1]) + (m[2] ? '<span class="y-dash">- </span>' : '') + `<span class="y-key">${esc(m[3])}</span><span class="y-p">:</span>${m[5]}` + (m[6] ? `<span class="${/^["']/.test(m[6]) ? 'y-str' : /^(true|false|\d+)$/.test(m[6].trim()) ? 'y-num' : 'y-val'}">${esc(m[6])}</span>` : '');
    } else {
      const d = code.match(/^(\s*)(- )(.*)$/);
      if (d) html = esc(d[1]) + '<span class="y-dash">- </span>' + `<span class="${/^["']/.test(d[3]) ? 'y-str' : 'y-val'}">${esc(d[3])}</span>`;
      else if (/^---/.test(code)) html = `<span class="y-doc">${esc(code)}</span>`;
      else html = esc(code);
    }
    return html + (com ? `<span class="y-com">${esc(com)}</span>` : '');
  }
  const hlYAML = (text) => text.split('\n').map(hlYAMLLine).join('\n');

  class Term {
    constructor(el, opts = {}) {
      this.el = el;
      this.busy = false;
      this.hIdx = null;
      const cmds = [...el.querySelectorAll('code.cmd, .cmd')].map((c) => c.textContent.trim()).filter(Boolean);
      const catchup = el.dataset.catchup;
      const title = el.dataset.title || SHELL.title || `${SHELL.user}: ${SHELL.dir}`;
      el.classList.add('term-ready');
      el.innerHTML = `
        <div class="term-bar">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="term-title">${esc(title)}</span>
          <span class="term-actions">
            ${catchup ? `<button class="term-btn catchup" title="Put the shell in the state it would be in at the start of ${esc(catchup)}">⏩ catch up to ${esc(catchup)}</button>` : ''}
            <button class="term-btn clr" title="Clear (Ctrl+L)">clear</button>
          </span>
        </div>
        <div class="term-body" tabindex="-1">
          <div class="term-out"></div>
          <div class="term-in">${PS1}<input spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="terminal input" /></div>
        </div>
        ${cmds.length ? `<div class="term-chips"><span class="chips-lbl">try</span>${cmds.map((c, i) => `<button class="chip" data-i="${i}" title="${esc(c)}"><span>${esc(c)}</span></button>`).join('')}</div>` : ''}`;
      this.cmds = cmds;
      this.out = el.querySelector('.term-out');
      this.body = el.querySelector('.term-body');
      this.input = el.querySelector('input');
      this.print(opts.greeting || (cmds.length ? '# click a command below, or type your own (help lists everything)' : '# type help to see what this shell understands'), 'dim');

      el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => this.typeAndRun(this.cmds[+b.dataset.i], b)));
      const cu = el.querySelector('.catchup');
      if (cu) cu.addEventListener('click', () => this.typeAndRun('catchup ' + catchup));
      el.querySelector('.clr').addEventListener('click', () => { this.clear(); this.input.focus(); });
      this.body.addEventListener('mouseup', () => { if (!window.getSelection().toString()) this.input.focus({ preventScroll: true }); });
      this.input.addEventListener('keydown', (e) => this.onKey(e));
    }

    print(text, cls = '') {
      const div = document.createElement('div');
      div.className = 'ln' + (cls ? ' ' + cls : '');
      if (cls === 'yaml') div.innerHTML = hlYAML(text);
      else if (cls === 'ls') div.innerHTML = esc(text).replace(/\u0001(.*?)\u0002/g, '<span class="ls-dir">$1</span>').replace(/^(.*\.ya?ml)$/gm, '<span class="ls-yaml">$1</span>');
      else if (cls === 'hint') div.textContent = '↳ ' + text;
      else div.textContent = text;
      this.out.appendChild(div);
      this.scroll();
    }
    scroll() { this.body.scrollTop = this.body.scrollHeight; }
    // Long output: keep the command line at the top so the reader starts at the beginning.
    scrollToResult(echo) {
      const b = this.body;
      const top = echo.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 6;
      if (b.scrollHeight - top > b.clientHeight * 1.05) { this.print('↓ long output: scroll down inside the terminal', 'dim'); b.scrollTop = Math.max(0, top); }
      else this.scroll();
    }
    clear() { this.out.innerHTML = ''; }

    async run(line) {
      if (this.busy) return;
      this.busy = true;
      this.el.classList.add('busy');
      const echo = document.createElement('div');
      echo.className = 'ln echo';
      echo.innerHTML = `${PS1} ${esc(line)}`;
      this.out.appendChild(echo);
      this.input.value = '';
      this.hIdx = null;
      const ctx = {
        out: (t, c) => this.print(t, c), err: (t) => this.print(t, 'err'), hint: (t) => this.print(t, 'hint'), ok: (t) => this.print(t, 'ok'),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)), clear: () => this.clear(),
      };
      // Canned output only for commands the shell plugin doesn't simulate; otherwise the plugin's
      // state would miss the command (a canned "created" followed by a real "not found").
      const first = line.trim().split(/\s+/)[0];
      const simulated = (SHELL.handles || []).includes(first);
      const canned = !simulated && window.CANNED ? window.CANNED[line.trim()] : undefined;
      try {
        if (canned !== undefined) {
          const H = window.SIM && SIM.state && SIM.state().history;
          if (H && H[H.length - 1] !== line.trim()) H.push(line.trim());
          await ctx.sleep(120);
          this.print(canned, /^\s*(apiVersion|kind):/m.test(canned) ? 'yaml' : '');
        } else await SIM.exec(line, ctx);
      } catch (e) { console.error(e); this.print('shell error: ' + e.message, 'err'); }
      this.busy = false;
      this.el.classList.remove('busy');
      this.scrollToResult(echo);
      document.dispatchEvent(new CustomEvent('term:ran', { detail: { line } }));
    }

    async typeAndRun(cmd, chip) {
      if (this.busy || this.typing) return;
      this.typing = true;
      if (chip) chip.classList.add('used');
      this.input.focus({ preventScroll: true });
      const step = Math.max(6, Math.min(22, 700 / cmd.length));
      this.input.value = '';
      for (let i = 1; i <= cmd.length; i++) {
        this.input.value = cmd.slice(0, i);
        this.input.scrollLeft = this.input.scrollWidth;
        await new Promise((r) => setTimeout(r, step));
      }
      await new Promise((r) => setTimeout(r, 140));
      this.typing = false;
      return this.run(cmd);
    }

    onKey(e) {
      const H = (SIM.state && SIM.state().history) || [];
      if (e.key === 'Enter') { e.preventDefault(); const v = this.input.value; if (v.trim()) this.run(v); else this.print('', ''); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (!H.length) return; this.hIdx = this.hIdx === null ? H.length - 1 : Math.max(0, this.hIdx - 1); this.input.value = H[this.hIdx]; return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (this.hIdx === null) return; this.hIdx++; if (this.hIdx >= H.length) { this.hIdx = null; this.input.value = ''; } else this.input.value = H[this.hIdx]; return; }
      if (e.key === 'Tab') { e.preventDefault(); this.complete(); return; }
      if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.clear(); return; }
      if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) { e.preventDefault(); this.print(`${SHELL.user}:${SHELL.dir}$ ${this.input.value}^C`, 'dim'); this.input.value = ''; }
    }

    // A shell plugin may provide SIM.complete(head, last) -> candidates; otherwise complete
    // command names, then file names.
    complete() {
      const v = this.input.value;
      const parts = v.split(/\s+/);
      const last = parts.pop();
      const head = parts.filter(Boolean);
      const comp = (SIM.completions && SIM.completions()) || {};
      const files = comp.files || [];
      let cands = SIM.complete ? SIM.complete(head, last) : null;
      if (!cands) cands = !head.length ? (comp.commands || []).concat(Object.keys(window.CANNED || {}).map((c) => c.split(/\s+/)[0])) : files;
      cands = [...new Set(cands)].filter((c) => c.startsWith(last));
      if (!cands.length) return;
      if (cands.length === 1) { this.input.value = [...parts, cands[0]].join(' ') + (cands[0].endsWith('/') ? '' : ' '); return; }
      let pre = cands[0];
      for (const c of cands) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
      if (pre.length > last.length) { this.input.value = [...parts, pre].join(' '); return; }
      this.print(cands.join('   '), 'dim');
    }
  }

  window.Term = Term;
  window.hlYAML = hlYAML;
  window.escHTML = esc;
})();
