// Terminal widget. Every instance talks to the same SIM, so state is shared.
(function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // YAML highlighter shared with code blocks.
  function hlYAMLLine(line) {
    const ci = (() => { let q = null; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i; } return -1; })();
    let code = ci >= 0 ? line.slice(0, ci) : line;
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

  const KUBECTL_VERBS = ['get', 'describe', 'apply', 'delete', 'create', 'explain', 'logs', 'wait', 'edit'];
  const RESOURCES = ['pods', 'svc', 'ing', 'ingress', 'ingressclasses', 'secrets', 'endpointslices', 'namespaces', 'nodes'];
  const COMMANDS = ['kubectl', 'curl', 'cat', 'ls', 'help', 'clear', 'history', 'reset', 'catchup', 'openssl', 'echo', 'nslookup', 'getent', 'minikube'];

  class Term {
    constructor(el, opts = {}) {
      this.el = el;
      this.busy = false;
      this.hIdx = null;
      const cmds = [...el.querySelectorAll('code.cmd, .cmd')].map((c) => c.textContent.trim()).filter(Boolean);
      const catchup = el.dataset.catchup;
      const title = el.dataset.title || 'kiada@kind: ~/Chapter12';
      el.innerHTML = '';
      el.classList.add('term-ready');
      el.innerHTML = `
        <div class="term-bar">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="term-title">${esc(title)}</span>
          <span class="term-actions">
            ${catchup ? `<button class="term-btn catchup" title="Put the simulated cluster in the state it would be in at the start of ${esc(catchup)}">⏩ catch up to ${esc(catchup)}</button>` : ''}
            <button class="term-btn clr" title="Clear (Ctrl+L)">clear</button>
          </span>
        </div>
        <div class="term-body" tabindex="-1">
          <div class="term-out"></div>
          <div class="term-in"><span class="ps1"><span class="ps-u">kiada@kind</span>:<span class="ps-d">~/Chapter12</span>$</span><input spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="terminal input" /></div>
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
    clear() { this.out.innerHTML = ''; }

    async run(line) {
      if (this.busy) return;
      this.busy = true;
      this.el.classList.add('busy');
      const echo = document.createElement('div');
      echo.className = 'ln echo';
      echo.innerHTML = `<span class="ps1"><span class="ps-u">kiada@kind</span>:<span class="ps-d">~/Chapter12</span>$</span> ${esc(line)}`;
      this.out.appendChild(echo);
      this.input.value = '';
      this.hIdx = null;
      const ctx = {
        out: (t, c) => this.print(t, c), err: (t) => this.print(t, 'err'), hint: (t) => this.print(t, 'hint'), ok: (t) => this.print(t, 'ok'),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)), clear: () => this.clear(),
      };
      try { await SIM.exec(line, ctx); } catch (e) { console.error(e); this.print('simulator error: ' + e.message, 'err'); }
      this.busy = false;
      this.el.classList.remove('busy');
      this.scroll();
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
      const H = SIM.state().history;
      if (e.key === 'Enter') { e.preventDefault(); const v = this.input.value; if (v.trim()) this.run(v); else this.print('', ''); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (!H.length) return; this.hIdx = this.hIdx === null ? H.length - 1 : Math.max(0, this.hIdx - 1); this.input.value = H[this.hIdx]; return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (this.hIdx === null) return; this.hIdx++; if (this.hIdx >= H.length) { this.hIdx = null; this.input.value = ''; } else this.input.value = H[this.hIdx]; return; }
      if (e.key === 'Tab') { e.preventDefault(); this.complete(); return; }
      if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.clear(); return; }
      if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) { e.preventDefault(); this.print(`kiada@kind:~/Chapter12$ ${this.input.value}^C`, 'dim'); this.input.value = ''; }
    }

    complete() {
      const v = this.input.value;
      const parts = v.split(/\s+/);
      const last = parts.pop();
      const head = parts.filter(Boolean);
      const cmd = head[0] === 'k' ? 'kubectl' : head[0];
      const files = SIM.completions().files;
      let cands = [];
      if (!head.length) cands = COMMANDS;
      else if (cmd === 'kubectl') {
        const verb = head[1];
        const prev = head[head.length - 1];
        if (head.length === 1) cands = KUBECTL_VERBS;
        else if (prev === '-f') cands = files;
        else if (['get', 'describe', 'delete', 'explain'].includes(verb) && head.length === 2) cands = verb === 'explain' ? ['ingress', 'ingress.spec'] : RESOURCES;
        else if (['describe', 'delete', 'get'].includes(verb) && /^(ing|ingress|ingresses)$/.test(head[2]) ) cands = Object.keys(SIM.state().ingresses);
        else if (verb === 'apply' || verb === 'delete') cands = ['-f'];
      } else if (['cat', 'less', 'bat'].includes(cmd)) cands = [...files, '/etc/hosts'];
      else if (cmd === 'catchup') cands = SIM.sections.slice(4);
      cands = cands.filter((c) => c.startsWith(last));
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
