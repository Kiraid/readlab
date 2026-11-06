// Deterministic fixes for mistakes a model makes often, applied before any model retry.
// Each fix is small, safe and reported; anything that needs judgement stays an error.
import { FormatError, parseSection } from './parse.mjs';

/** Apply fixes until nothing changes. Returns { text, fixes: [string] }. */
export function autofix(text, { files = {} } = {}) {
  const fixes = [];
  let t = String(text);
  const step = (name, fn) => { const next = fn(t); if (next !== t) { fixes.push(name); t = next; } };

  step('line endings and trailing spaces', (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, ''));
  step('tabs replaced with spaces', (s) => s.replace(/\t/g, '  '));
  step('front matter id quoted', (s) => s.replace(/^(---\n[\s\S]*?^id:\s*)(\d+(?:\.\d+)*)\s*$/m, '$1"$2"'));
  step('body headings turned into ####', (s) => {
    const fm = /^---\n[\s\S]*?\n---\n/.exec(s);
    const head = fm ? fm[0] : '';
    return head + s.slice(head.length).replace(/^#{1,3}(\s)/gm, '####$1');
  });

  // inside :::quiz, accept common quiz notations
  step('quiz markers normalised', (s) => s.replace(/^(:::quiz[^\n]*\n)([\s\S]*?)(^:::\s*$)/gm, (m, open, body, close) => open + body
    .replace(/^\s*[-*]\s*\[[xX✓]\]\s*/gm, '+ ')
    .replace(/^\s*[-*]\s*\[\s?\]\s*/gm, '- ')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/^\s*(?:Q|Question)\s*[:.]\s*/gim, '? ')
    .replace(/^\s*(?:Explanation|Why|Answer)\s*[:.]\s*/gim, '> ') + close));

  // one :::quiz block holding several "? question" lines becomes one block per question
  step('quiz blocks split one question each', (s) => s.replace(/^(:::quiz[^\n]*)\n([\s\S]*?)^:::\s*$/gm, (m, open, body) => {
    const parts = body.split(/^(?=\?\s)/m).filter((p) => p.trim());
    if (parts.length < 2) return m;
    return parts.map((p) => `${open}\n${p.replace(/\s+$/, '')}\n:::`).join('\n\n');
  }));

  // inside :::term, other prompt characters become "$ "
  step('terminal prompts normalised', (s) => s.replace(/^(:::term[^\n]*\n)([\s\S]*?)(^:::\s*$)/gm, (m, open, body, close) => open + body
    .replace(/^\s*(?:❯|%|>|\$)\s*(?=\S)/gm, '$ ') + close));

  // :::code src= with the wrong case or a path prefix, when exactly one file matches
  const names = Object.keys(files);
  step('code src matched to a chapter file', (s) => s.replace(/^(:::code\b[^\n]*?\bsrc=)(\S+)/gm, (m, pre, src) => {
    if (names.includes(src)) return m;
    const base = src.split('/').pop();
    const hit = names.filter((n) => n === base || n.toLowerCase() === base.toLowerCase());
    return hit.length === 1 ? pre + hit[0] : m;
  }));

  // a directive left open at the end of the file gets its closing fence
  for (let k = 0; k < 3; k++) {
    try { parseSection(t); break; } catch (e) {
      const m = e instanceof FormatError && /never closed \(expected a line "(:{3,})"\)/.exec(e.message);
      if (!m) break;
      t = t.replace(/\n*$/, '\n') + m[1] + '\n';
      fixes.push(`closed an unclosed directive (${m[1]})`);
    }
  }
  return { text: t, fixes };
}
