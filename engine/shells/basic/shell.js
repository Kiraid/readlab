// Default shell plugin for books without a simulator: builtins, the virtual files, and the
// canned commands from :::term blocks (answered by the terminal before this runs).
(function () {
  const S = { history: [] };
  const listeners = new Set();
  const files = () => Object.keys(window.FILES || {});
  const canned = () => Object.keys(window.CANNED || {});

  function help() {
    const page = canned();
    return ['Builtins: help · clear (Ctrl+L) · ls · cat <file> · history · echo <text>',
      page.length ? `Commands with output on this page (${page.length}):\n  ` + page.slice(0, 30).join('\n  ') + (page.length > 30 ? '\n  …' : '') : '',
      'Tab completes, ↑/↓ walks history, the ` key opens the drop-down shell.'].filter(Boolean).join('\n');
  }

  async function exec(line, ctx) {
    const raw = line.trim();
    if (!raw) return;
    if (raw !== S.history[S.history.length - 1]) S.history.push(raw);
    const [cmd, ...args] = raw.split(/\s+/);
    switch (cmd) {
      case 'help': case '?': ctx.out(help()); return;
      case 'clear': ctx.clear(); return;
      case 'history': ctx.out(S.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n')); return;
      case 'ls': ctx.out(files().join('\n') || '(no files in this chapter)', 'ls'); return;
      case 'echo': ctx.out(args.join(' ').replace(/^["']|["']$/g, '')); return;
      case 'cat': {
        const f = args[0];
        if (!f) { ctx.err('cat: missing file operand'); return; }
        if (!(f in (window.FILES || {}))) { ctx.err(`cat: ${f}: No such file or directory`); return; }
        ctx.out(window.FILES[f], /\.ya?ml$/.test(f) ? 'yaml' : '');
        return;
      }
      case 'catchup': ctx.ok(`(nothing to catch up: this shell has no state between sections)`); return;
      case 'reset': S.history.length = 0; ctx.ok('history cleared'); return;
      default:
        ctx.err(`${cmd}: command not found in this simulated shell`);
        ctx.hint('This shell answers the commands shown on the page (help lists them) plus a few builtins.');
    }
    listeners.forEach((f) => f());
  }

  window.SIM = {
    exec, state: () => S, on: (f) => { listeners.add(f); return () => listeners.delete(f); },
    completions: () => ({ files: files(), commands: ['help', 'clear', 'ls', 'cat', 'history', 'echo'] }),
    sections: [],
  };
})();
