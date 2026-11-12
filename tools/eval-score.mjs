#!/usr/bin/env node
// Score one writer output for an eval case: validate it against the clipped source, build the page,
// and count what it uses. Writes <case-dir>/out/<name>.score.json and <name>.html.
//
//   node tools/eval-score.mjs <case-dir> <output.md>
//
// must (pass/fail): builds without format errors, no copied runs, every listing shown, commands name real files.
// should (0-100):   coverage, the retelling's length against the source's prose (LENGTH_RATIO), the visuals,
//                   quizzes and terminals the plan asked for, and few warnings. Creative choices are not scored.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { buildChapter } from './build.mjs';
import { parseBlocks, parseSection } from './format/parse.mjs';
import { LENGTH_RATIO } from './format/checks.mjs';
import { validateChapter } from './validate.mjs';

function inventory(raw) {
  const all = [];
  const walk = (nodes) => nodes.forEach((n) => {
    if (n.type !== 'directive') return;
    all.push(n);
    if (['tabs', 'callout'].includes(n.name)) { try { walk(parseBlocks(n.body.split('\n').filter((l) => !/^@\s/.test(l)).join('\n'))); } catch (e) { /* ignore */ } }
  });
  try { walk(parseSection(raw).nodes); } catch (e) { /* format errors are reported by the validator */ }
  const count = (name, variant) => all.filter((d) => d.name === name && (!variant || d.variant === variant)).length;
  return {
    diagrams: count('diagram'), widgets: count('widget'), quizzes: count('quiz'), terminals: count('term'),
    code: count('code'), callouts: count('callout'), tabs: count('tabs'), recaps: count('recap'), requests: count('widget-request'),
    widget_names: [...new Set(all.filter((d) => d.name === 'widget').map((d) => d.variant))],
    tables: (raw.match(/^\|.*\|\s*\n\|[\s:|-]+\|\s*$/gm) || []).length,
  };
}

export function scoreOutput(caseDir, outputPath, { writeFixed = false } = {}) {
  const kase = parseYaml(readFileSync(join(caseDir, 'case.yaml'), 'utf8'));
  const raw = readFileSync(outputPath, 'utf8').replace(/^```[a-z]*\n([\s\S]*?)\n```\s*$/m, '$1'); // tolerate a fenced reply
  const dir = join(tmpdir(), `itb-eval-${kase.id}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'sections'), { recursive: true });
  writeFileSync(join(dir, 'chapter.yaml'), `id: ${kase.id}\ntitle: "${kase.title.replace(/"/g, '\\"')}"\nshell: { plugin: ${kase.shell || 'basic'} }\n`);
  if (existsSync(join(caseDir, 'files'))) cpSync(join(caseDir, 'files'), join(dir, 'files'), { recursive: true });
  writeFileSync(join(dir, 'sections', '01.md'), raw);

  const rep = validateChapter(dir, { sourcePath: join(caseDir, 'source.json'), fix: true });
  const r = rep.results[0];
  const build = buildChapter(dir);
  const fixed = readFileSync(join(dir, 'sections', '01.md'), 'utf8');
  // the validator's safe fixes (a quiz block with two questions split in two, ...) are what was scored: keep them
  if (writeFixed && fixed !== raw) writeFileSync(outputPath, fixed);
  const inv = inventory(fixed);
  const exp = kase.expect || {};
  const errs = (code) => r.errors.filter((e) => e.code === code).length;

  const must = {
    builds: build.errors.length === 0,
    no_copy: errs('copy') === 0,
    listings_shown: errs('listing') === 0,
    files_exist: errs('files') === 0,
  };
  // length follows the source: full marks inside LENGTH_RATIO of its prose, falling off proportionally outside.
  // Visuals are scored only against what the plan asked for (its builds and the book's figures): counting visuals
  // or rewarding a suggested widget made writers draw the text itself (2026-11 DDIA runs).
  const ratio = r.metrics.length_ratio;
  const [lo, hi] = LENGTH_RATIO;
  const visuals = inv.diagrams + inv.widgets;
  const should = {
    coverage: Math.min(1, (r.metrics.coverage ?? 0) / 100 / (exp.coverage ?? 0.6)),
    length: ratio == null ? 1 : ratio < lo ? ratio / lo : ratio > hi ? hi / ratio : 1,
    visuals: exp.visual_min ? Math.min(1, visuals / exp.visual_min) : 1,
    quizzes: exp.quiz_min ? Math.min(1, inv.quizzes / exp.quiz_min) : 1,
    terminals: exp.terminal_min ? Math.min(1, inv.terminals / exp.terminal_min) : 1,
    clean: Math.max(0, 1 - 0.1 * r.warnings.filter((w) => !['fixable'].includes(w.code)).length),
  };
  const weights = { coverage: 30, length: 15, visuals: 15, quizzes: 10, terminals: 10, clean: 20 };
  const score = Math.round(Object.entries(weights).reduce((s, [k, w]) => s + w * should[k], 0));
  const result = {
    case: kase.id, output: basename(outputPath), pass: Object.values(must).every(Boolean), score, must, should,
    metrics: { ...r.metrics, ...inv, build_errors: build.errors.length, warnings: r.warnings.map((w) => w.code), fixed: r.fixed },
    issues: [...r.errors.map((e) => `error [${e.code}]${e.line ? ` line ${e.line}:` : ''} ${e.message}`), ...build.errors.map((e) => `build${e.line ? ` line ${e.line}:` : ''} ${e.message}`), ...r.warnings.map((w) => `warning [${w.code}] ${w.message}`)],
  };
  const out = join(caseDir, 'out');
  mkdirSync(out, { recursive: true });
  const stem = basename(outputPath).replace(/\.md$/, '');
  writeFileSync(join(out, `${stem}.score.json`), JSON.stringify(result, null, 2));
  if (!build.errors.length) writeFileSync(join(out, `${stem}.html`), build.html);
  // the shared log is for eval cases; a pipeline job keeps its requests with its page (page/dist/widget-requests.json)
  const isJob = /[\\/]sources[\\/]jobs[\\/]/.test(resolve(caseDir));
  result.widget_requests = isJob ? (build.requests || []).map((r) => r.name) : logWidgetRequests(kase.id, stem, build.requests || []);
  return result;
}

// Widgets a writer asked for (:::widget-request) are logged, not built: evals/widget-requests.jsonl, one JSON
// object per line, keyed by case + run + name so re-scoring the same output doesn't duplicate entries.
export const REQUEST_LOG = fileURLToPath(new URL('../evals/widget-requests.jsonl', import.meta.url));

function logWidgetRequests(caseId, run, requests) {
  const rows = existsSync(REQUEST_LOG) ? readFileSync(REQUEST_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const key = (r) => `${r.case}|${r.run}|${r.name}`;
  const fresh = requests.map(({ file, line, ...req }) => ({ logged: new Date().toISOString().slice(0, 10), case: caseId, run, ...req }));
  const keep = rows.filter((r) => !(r.case === caseId && r.run === run));
  const all = [...keep, ...fresh];
  if (fresh.length || keep.length !== rows.length) writeFileSync(REQUEST_LOG, all.map((r) => JSON.stringify(r)).join('\n') + (all.length ? '\n' : ''));
  return fresh.map(key);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [caseDir, output] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!caseDir || !output) { console.error('usage: node tools/eval-score.mjs <case-dir> <output.md> [--write-fixed]'); process.exit(2); }
  const r = scoreOutput(resolve(caseDir), resolve(output), { writeFixed: process.argv.includes('--write-fixed') });
  console.log(`${r.case} ${r.output}: ${r.pass ? 'PASS' : 'FAIL'}  score ${r.score}/100`);
  console.log(`  must:   ${Object.entries(r.must).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join('  ')}`);
  console.log(`  should: ${Object.entries(r.should).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join('  ')}`);
  const m = r.metrics;
  console.log(`  uses:   ${m.diagrams} diagrams, ${m.widgets} widgets (${m.widget_names.join(', ') || '-'}), ${m.quizzes} quizzes, ${m.terminals} terminals, ${m.code} listings, ${m.callouts} callouts, ${m.tables} tables`);
  console.log(`  text:   ${m.words} words, ${m.retell_words} without quizzes/recaps (source ${m.source_words}, ${Math.round((m.length_ratio ?? 0) * 100)}%), coverage ${m.coverage}%, paragraphs ${m.paragraphs_judged - m.paragraphs_missing}/${m.paragraphs_judged}, copy overlap ${m.copy_overlap}%`);
  for (const i of r.issues) console.log(`  ${i}`);
  if (r.widget_requests.length) console.log(`  widget requests logged to evals/widget-requests.jsonl: ${r.widget_requests.map((k) => k.split('|')[2]).join(', ')}`);
  process.exit(r.pass ? 0 : 1);
}
