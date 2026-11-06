// Checks a written section against the source section it was written from (extract.json from
// `python -m pipeline.ingest chapter`). All deterministic: no model involved.
//
//   copy        8+ word runs shared with the source prose (error) and the overlap %
//   coverage    share of the source's key terms that appear in the section (warning below a threshold)
//   inventory   every source listing used as :::code (error); commands, tables, figures, callouts (warnings)
//   numbers     numbers in the prose that appear nowhere in the source or the chapter files (warning)
//   budget      prose length compared with the source, or with front matter `words: [min, max]` (warning)
//   files       commands that name a file (-f X, cat X) must name a file in files/ (error)
import { parseBlocks, parseSection } from './parse.mjs';

export const COPY_RUN = 8;

/** Lowercase word tokens; numbers stay as tokens. */
export function words(text) {
  return (String(text).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/g) || []);
}

const stripInline = (t) => String(t)
  .replace(/`[^`\n]*`/g, ' ')                 // inline code: identifiers may be verbatim
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links: keep the text
  .replace(/[*_#>|]/g, ' ');

/** The prose of a written section: Markdown, callouts, quiz text, recaps, tab panels. No code, terminals, diagrams or widget configs. */
export function sectionProse(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'md') out.push(n.text.replace(/```[\s\S]*?```/g, ' '));
    else if (n.name === 'callout' || n.name === 'recap') out.push(sectionProse(parseBlocks(n.body)));
    else if (n.name === 'tabs') out.push(sectionProse(parseBlocks(n.body.split('\n').filter((l) => !/^@\s/.test(l)).join('\n'))));
    else if (n.name === 'quiz') out.push(n.body.replace(/^\s*[?+\->]\s?/gm, ''));
  }
  return stripInline(out.join('\n'));
}

/** All text of a written section (for coverage): prose, code blocks, terminal commands, diagram labels. */
export const sectionAllText = (raw) => String(raw).replace(/^---[\s\S]*?\n---/, '');

/** Source prose from extract.json blocks. */
export function sourceProse(sec) {
  return stripInline((sec.blocks || []).filter((b) => ['para', 'item', 'callout', 'subheading', 'figure', 'table', 'listing_caption'].includes(b.kind))
    .map((b) => [b.text, ...(b.meta?.rows || []).flat(), ...(b.meta?.header || [])].join(' ')).join('\n'));
}
export const sourceAllText = (sec) => (sec.blocks || []).map((b) => [b.text, b.meta?.caption || '', ...(b.meta?.rows || []).flat()].join(' ')).join('\n');

/** Runs of `n`+ consecutive words shared with the source. Returns { runs: [{at, len, preview}], overlap }. */
export function copyRuns(outText, srcText, n = COPY_RUN) {
  const a = words(outText), b = words(srcText);
  if (a.length < n || b.length < n) return { runs: [], overlap: 0 };
  const src = new Set();
  for (let i = 0; i + n <= b.length; i++) src.add(b.slice(i, i + n).join(' '));
  const hit = new Array(a.length - n + 1).fill(false);
  for (let i = 0; i + n <= a.length; i++) hit[i] = src.has(a.slice(i, i + n).join(' '));
  const runs = [];
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i]) continue;
    let j = i;
    while (j + 1 < hit.length && hit[j + 1]) j++;
    const len = j - i + n;
    runs.push({ at: i, len, preview: a.slice(i, i + Math.min(6, len)).join(' ') + (len > 6 ? ' …' : '') });
    i = j;
  }
  const shared = hit.filter(Boolean).length;
  return { runs, overlap: Math.round((1000 * shared) / hit.length) / 10 };
}

/** Which source key terms appear in the written section (case-insensitive). */
export function coverage(allText, features = {}) {
  const terms = [...new Set([...(features.introduced_terms || []), ...(features.key_terms || []).slice(0, 15)])]
    .filter((t) => t && t.length > 2 && !/^\d+$/.test(t));
  const hay = allText.toLowerCase();
  const hit = terms.filter((t) => hay.includes(t.toLowerCase()));
  return { terms, hit, miss: terms.filter((t) => !hit.includes(t)), ratio: terms.length ? hit.length / terms.length : 1 };
}

const NUM = /\b(?:\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?|\d+(?:\.\d+)+|\d{2,}(?:[.,]\d+)?%?|\d+(?:ms|s|m|h|mb|gb|kb|%))\b/gi;

/** Numbers in the prose that the source and the chapter files never mention. */
export function strayNumbers(prose, srcText, filesText, ignore = []) {
  const known = new Set([...(srcText + '\n' + filesText).matchAll(NUM)].map((m) => m[0].toLowerCase()));
  const skip = new Set(ignore.map(String));
  const out = new Set();
  for (const m of String(prose).matchAll(NUM)) {
    const v = m[0].toLowerCase();
    const before = prose.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
    if (known.has(v) || skip.has(v) || /(lines?\s*(\d+\s*[–-]\s*)?|steps?\s*|§\s*)$/.test(before)) continue;
    if (/^\d+$/.test(v) && +v < 10) continue;
    out.add(m[0]);
  }
  return [...out];
}

function directives(nodes, acc = []) {
  for (const n of nodes) {
    if (n.type !== 'directive') continue;
    acc.push(n);
    if (['tabs', 'callout'].includes(n.name)) {
      try { directives(parseBlocks(n.body.split('\n').filter((l) => !/^@\s/.test(l)).join('\n')), acc); } catch (e) { /* reported by the builder */ }
    }
  }
  return acc;
}

const termCommands = (ds) => ds.filter((d) => d.name === 'term').flatMap((d) => {
  const lines = d.body.split('\n');
  const dollar = lines.some((l) => l.startsWith('$ '));
  return lines.filter((l) => (dollar ? l.startsWith('$ ') : l.trim())).map((l) => (dollar ? l.slice(2) : l).trim());
});
const norm = (c) => c.replace(/\s+/g, ' ').trim();

/**
 * Validate one written section against its source.
 * @returns {{ errors: Issue[], warnings: Issue[], metrics: object }} where Issue = { code, line, message }
 */
export function checkSection(raw, { source = null, files = {} } = {}) {
  const errors = [], warnings = [], metrics = {};
  let parsed;
  try { parsed = parseSection(raw); } catch (e) { return { errors: [{ code: 'format', line: e.line, message: e.message }], warnings, metrics }; }
  const { meta, nodes } = parsed;
  const ds = directives(nodes);
  const prose = sectionProse(nodes);
  const all = sectionAllText(raw);
  metrics.words = words(prose).length;

  // files named in commands must exist
  for (const cmd of termCommands(ds)) {
    for (const m of cmd.matchAll(/(?:-f|cat|less|apply -f)\s+([^\s|;&]+)/g)) {
      const f = m[1];
      if (/^(https?:|\/|SETUP|-)/.test(f) || f.endsWith('/') || f in files) continue;
      errors.push({ code: 'files', line: null, message: `command "${cmd}" names "${f}", which is not in the chapter's files/` });
    }
  }

  if (!source) {
    warnings.push({ code: 'source', line: null, message: `no source section ${meta.id} in the extract; source checks skipped` });
    return { errors, warnings, metrics };
  }

  // copy
  const src = sourceProse(source);
  const { runs, overlap } = copyRuns(prose, src);
  metrics.copy_overlap = overlap;
  metrics.copy_runs = runs.length;
  for (const r of runs) errors.push({ code: 'copy', line: null, message: `${r.len} words in a row match the source ("${r.preview}"); rewrite in your own words` });

  // coverage
  const cov = coverage(all, source.features);
  metrics.coverage = Math.round(cov.ratio * 100);
  if (cov.terms.length >= 4 && cov.ratio < 0.6) {
    warnings.push({ code: 'coverage', line: null, message: `covers ${cov.hit.length}/${cov.terms.length} key terms; missing: ${cov.miss.slice(0, 8).join(', ')}` });
  }

  // inventory
  const used = new Set(ds.filter((d) => d.name === 'code' && d.args.src).map((d) => d.args.src));
  for (const b of source.blocks || []) {
    if (b.kind === 'code' && b.meta?.listing) {
      const name = b.meta.saved_as || b.meta.file;
      if (name && !used.has(name)) errors.push({ code: 'listing', line: null, message: `listing ${b.meta.listing} (${name}) is not shown; add :::code src=${name}` });
    }
  }
  const chips = termCommands(ds).map(norm);
  const srcCmds = (source.features?.commands || []).map((c) => norm(c.cmd));
  const missingCmds = srcCmds.filter((c) => !chips.some((x) => x === c || x.startsWith(c) || c.startsWith(x)) && !all.includes(c));
  if (missingCmds.length) warnings.push({ code: 'commands', line: null, message: `${missingCmds.length} source command(s) not in any terminal: ${missingCmds.slice(0, 5).map((c) => `\`${c}\``).join(', ')}` });
  const count = (kind) => (source.blocks || []).filter((b) => b.kind === kind).length;
  const tablesOut = (raw.match(/^\|.*\|\s*\n\|[\s:|-]+\|\s*$/gm) || []).length + ds.filter((d) => d.name === 'widget' && /matrix-explorer|rule-tester/.test(d.variant)).length;
  const figsOut = ds.filter((d) => d.name === 'diagram' || (d.name === 'widget' && /diagram:/.test(d.body))).length;
  const calloutsOut = ds.filter((d) => d.name === 'callout').length;
  for (const [what, have, need] of [['table', tablesOut, count('table')], ['figure', figsOut, count('figure')], ['callout', calloutsOut, count('callout')]]) {
    if (have < need) warnings.push({ code: 'inventory', line: null, message: `the source has ${need} ${what}(s), the section has ${have}` });
  }

  // numbers
  const stray = strayNumbers(prose, sourceAllText(source), Object.values(files).join('\n'), [meta.id, ...(String(meta.pages || '').split('-'))]);
  if (stray.length) warnings.push({ code: 'numbers', line: null, message: `numbers not found in the source: ${stray.slice(0, 8).join(', ')} (check they are not invented)` });

  // budget
  const srcWords = words(src).length;
  metrics.source_words = srcWords;
  const [lo, hi] = Array.isArray(meta.words) ? meta.words : [Math.round(srcWords * 0.35), Math.round(srcWords * 1.8)];
  if (srcWords > 60 || Array.isArray(meta.words)) {
    if (metrics.words < lo) warnings.push({ code: 'budget', line: null, message: `${metrics.words} words of prose; expected at least ${lo}` });
    if (metrics.words > hi) warnings.push({ code: 'budget', line: null, message: `${metrics.words} words of prose; expected at most ${hi}` });
  }
  return { errors, warnings, metrics };
}
