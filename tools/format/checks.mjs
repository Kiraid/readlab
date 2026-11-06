// Checks a written section against the source section it was written from (extract.json from
// `python -m pipeline.ingest chapter`). All deterministic: no model involved.
//
//   copy        8+ word runs shared with the source prose (error) and the overlap %
//   coverage    share of the source's key terms that appear in the section (warning below a threshold)
//   paragraph   per source paragraph: share of its distinctive tokens found in the section (warning per thin one)
//   inventory   every source listing used as :::code (error); commands, tables, figures, callouts (warnings)
//   numbers     numbers in the prose that appear nowhere in the source or the chapter files (warning)
//   budget      prose (without quizzes and recaps) 85–115% of the source's prose, or front matter `words: [min, max]` (warning)
//   files       commands that name a file (-f X, cat X) must name a file in files/ (error)
import { parseBlocks, parseSection } from './parse.mjs';

export const COPY_RUN = 8;
/** Prose length as a share of the source's prose: below the first is likely cut content, above the second is padding. */
export const LENGTH_RATIO = [0.85, 1.15];

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
    // headings are skipped: the faithful-coverage skill asks writers to keep the source's own sub-headings
    if (n.type === 'md') out.push(n.text.replace(/```[\s\S]*?```/g, ' ').replace(/^#{1,6}\s.*$/gm, ' '));
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
  // same tokens with their original case, to tell a list of names ("Oracle 11g, PostgreSQL, SQL Server")
  // from copied prose
  const orig = String(outText).replace(/[’']/g, '').match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/gi) || [];
  const runs = [];
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i]) continue;
    let j = i;
    while (j + 1 < hit.length && hit[j + 1]) j++;
    const len = j - i + n;
    const toks = orig.slice(i, i + len);
    const namey = toks.slice(1).filter((t) => /^[A-Z]/.test(t) || /\d/.test(t)).length / Math.max(1, toks.length - 1);
    runs.push({ at: i, len, names: namey >= 0.5, preview: a.slice(i, i + Math.min(6, len)).join(' ') + (len > 6 ? ' …' : '') });
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

// Everyday words that say nothing about which paragraph a sentence came from.
const COMMON = new Set(`about above after again against almost along already also although always among another
answer anything around because become becomes before being below between beyond both called cannot case cases
certain change changes clear could course different does doing done during each either else enough entire even
every example exactly first following found fully further given going great happen happens however important
instead into itself just keep kind know large later least less like likely little longer look make makes making
many might more most much must need needs never next nothing notice number often only order other others otherwise
over part particular perhaps place point possible pretty probably quite rather really right same second section
seems several should shown simple simply since small some something sometimes soon still such sure take taken
than that their them themselves then there these they thing things think third this those though through thus
time times together turn under until upon used useful uses using usually very want well what whatever when where
whether which while whole will with within without work works would write written your
additional associated actual actually available basically common consider considered correct describe described
discuss discussed effect finally general generally mention mentioned previous previously provide provides reason
remember require required result results similar specific typically various whereas`.split(/\s+/));

const stem = (w) => w.toLowerCase().replace(/[’']/g, '').replace(/(?:ations?|ings?|ed|es|ly|s)$/, '').slice(0, 7);

/**
 * Distinctive tokens of one source paragraph: inline code, numbers, CamelCase / capitalised terms and acronyms, and
 * rarer words (6+ letters, not everyday English, in at most `rare` blocks of the section per `df`).
 * Returns [{ kind, key }] where key is a stem (words) or a lowercase literal (code, numbers).
 */
export function distinctiveTokens(text, df = new Map(), rare = 2) {
  const out = new Map();
  const t = String(text);
  for (const m of t.matchAll(/`([^`\n]+)`/g)) out.set('c:' + m[1].toLowerCase(), { kind: 'code', key: m[1].toLowerCase() });
  for (const m of t.replace(/`[^`\n]*`/g, ' ').matchAll(/[A-Za-z0-9]+(?:[.\-_/][A-Za-z0-9]+)*%?/g)) {
    const w = m[0];
    const before = t.slice(0, m.index).trimEnd();
    const sentenceStart = !before || /[.!?:;"“(]$/.test(before);
    if (/\d/.test(w)) {
      if (/^\d$/.test(w)) continue; // single digits: "3" and "three" are the same fact
      out.set('n:' + w.toLowerCase(), { kind: 'number', key: w.toLowerCase() });
    } else if (/[_/.]/.test(w)) {
      out.set('c:' + w.toLowerCase(), { kind: 'code', key: w.toLowerCase() }); // paths, field.names: matched literally
    } else if (/[a-z][A-Z]|^[A-Z]{2,}s?$/.test(w) || (/^[A-Z]/.test(w) && !sentenceStart && w.length > 2)) {
      out.set('t:' + stem(w), { kind: 'term', key: stem(w) });
    } else if (w.length >= 6 && !COMMON.has(w.toLowerCase()) && (df.get(stem(w)) || 0) <= rare) {
      out.set('w:' + stem(w), { kind: 'word', key: stem(w) });
    }
  }
  return [...out.values()];
}

export const PARA_MIN_TOKENS = 4;   // paragraphs with fewer distinctive tokens are not judged
export const PARA_MIN_HIT = 0.3;    // below this weighted share of its tokens in the section, a paragraph counts as missing
// Names, numbers and code survive any rewording, so they count double; rarer words may be paraphrased away.
// Tuned on the first Opus eval run: own sections score 0.4–1.0 per paragraph (one 0.21), another book's section
// scores mostly under 0.3 against the same paragraphs.
const PARA_WEIGHT = { code: 2, number: 2, term: 2, word: 1 };

/**
 * Per-paragraph coverage: for each source para/item/callout block, the share of its distinctive tokens that appear
 * anywhere in the written section (prose, code, terminals, diagram labels, quizzes).
 * Returns [{ index, of, kind, tokens, hit, ratio, preview }] for the judged blocks.
 */
export function paragraphCoverage(allText, sec) {
  const blocks = (sec.blocks || []).filter((b) => ['para', 'item', 'callout'].includes(b.kind));
  const df = new Map();
  for (const b of sec.blocks || []) {
    for (const s of new Set(words(b.text).map(stem))) df.set(s, (df.get(s) || 0) + 1);
  }
  const hay = String(allText).toLowerCase();
  const stems = new Set((hay.replace(/[’']/g, '').match(/[a-z0-9]+/g) || []).map(stem));
  for (const w of words(hay)) stems.add(stem(w));
  const found = (x) => (x.kind === 'code' || x.kind === 'number' ? hay.includes(x.key) : stems.has(x.key));
  const weight = (list) => list.reduce((a, x) => a + PARA_WEIGHT[x.kind], 0);
  const out = [];
  blocks.forEach((b, i) => {
    const toks = distinctiveTokens(b.text, df);
    if (toks.length < PARA_MIN_TOKENS) return;
    const hit = toks.filter(found);
    const w = words(b.text);
    out.push({ index: i + 1, of: blocks.length, kind: b.kind, tokens: toks.length, hit: hit.length,
      ratio: weight(hit) / weight(toks), preview: w.slice(0, 6).join(' ') + (w.length > 6 ? ' …' : '') });
  });
  return out;
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
  // the retelling of the source, for the length check: quizzes and recaps are the page's own additions
  metrics.retell_words = words(sectionProse(nodes.filter((n) => n.name !== 'quiz' && n.name !== 'recap'))).length;

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
  for (const r of runs) {
    if (r.names) warnings.push({ code: 'copy-names', line: null, message: `${r.len} words match the source, mostly names or numbers ("${r.preview}"); fine if it is a list of facts` });
    else errors.push({ code: 'copy', line: null, message: `${r.len} words in a row match the source ("${r.preview}"); rewrite in your own words` });
  }

  // coverage
  const cov = coverage(all, source.features);
  metrics.coverage = Math.round(cov.ratio * 100);
  if (cov.terms.length >= 4 && cov.ratio < 0.6) {
    warnings.push({ code: 'coverage', line: null, message: `covers ${cov.hit.length}/${cov.terms.length} key terms; missing: ${cov.miss.slice(0, 8).join(', ')}` });
  }
  const paras = paragraphCoverage(all, source);
  const thin = paras.filter((p) => p.ratio < PARA_MIN_HIT);
  metrics.paragraphs_judged = paras.length;
  metrics.paragraphs_missing = thin.length;
  for (const p of thin) {
    warnings.push({ code: 'paragraph', line: null, message: `source ${p.kind} ${p.index}/${p.of} ("${p.preview}") may be missing: ${p.hit} of its ${p.tokens} distinctive terms appear in the section` });
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
  // a book figure can become a diagram or any visual widget (a timeline for a Gantt chart, a state machine...)
  const VISUAL_WIDGETS = /^(timeline|state-machine|toggle-compare|request-tracer|compare-scale|matrix-explorer)$/;
  const figsOut = ds.filter((d) => d.name === 'diagram' || (d.name === 'widget' && (VISUAL_WIDGETS.test(d.variant || '') || /diagram:/.test(d.body)))).length;
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
  metrics.length_ratio = srcWords ? Math.round((100 * metrics.retell_words) / srcWords) / 100 : null;
  if (Array.isArray(meta.words)) {
    const [lo, hi] = meta.words;
    if (metrics.words < lo) warnings.push({ code: 'budget', line: null, message: `${metrics.words} words of prose; front matter asks for at least ${lo}` });
    if (metrics.words > hi) warnings.push({ code: 'budget', line: null, message: `${metrics.words} words of prose; front matter asks for at most ${hi}` });
  } else if (srcWords > 60) {
    const pct = Math.round(metrics.length_ratio * 100);
    const say = `${metrics.retell_words} words of prose (quizzes and recaps not counted) is ${pct}% of the source's ${srcWords}`;
    if (metrics.length_ratio < LENGTH_RATIO[0]) warnings.push({ code: 'budget', line: null, message: `${say}; below ${Math.round(LENGTH_RATIO[0] * 100)}% it may have cut content` });
    if (metrics.length_ratio > LENGTH_RATIO[1]) warnings.push({ code: 'budget', line: null, message: `${say}; above ${Math.round(LENGTH_RATIO[1] * 100)}% is padding` });
  }
  return { errors, warnings, metrics };
}
