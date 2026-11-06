#!/usr/bin/env node
// Validate a chapter's written sections: the builder's format checks plus the source checks in
// tools/format/checks.mjs. Exit code 1 when any section has errors.
//
//   node tools/validate.mjs <chapter-dir> [--source <extract.json>] [--fix] [--json <report.json>]
//
// --source  the extract.json from `python -m pipeline.ingest chapter` (defaults to chapter.yaml `source:`)
// --fix     apply autofix to the section files first and write them back
// --json    also write the full report as JSON (what the pipeline's fix node reads)
//
// The report quotes at most six words of any copied run, so it can be shown without reproducing the source.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { loadCatalog, readFiles } from './build.mjs';
import { autofix } from './format/autofix.mjs';
import { checkSection } from './format/checks.mjs';
import { splitFrontMatter } from './format/parse.mjs';
import { newContext, renderSection } from './format/render.mjs';

export function validateChapter(dir, { sourcePath = null, fix = false } = {}) {
  if (!existsSync(join(dir, 'chapter.yaml')) || !existsSync(join(dir, 'sections'))) {
    throw new Error(`${dir} is not a chapter folder (needs chapter.yaml and sections/)`);
  }
  const chapter = parseYaml(readFileSync(join(dir, 'chapter.yaml'), 'utf8')) ?? {};
  const files = readFiles(join(dir, 'files'));
  const catalog = loadCatalog();
  const srcFile = sourcePath || (chapter.source ? resolve(dir, chapter.source) : null);
  const extract = srcFile && existsSync(srcFile) ? JSON.parse(readFileSync(srcFile, 'utf8')) : null;
  const byId = new Map((extract?.sections || []).map((s) => [String(s.id), s]));
  const results = [];
  for (const name of readdirSync(join(dir, 'sections')).filter((n) => n.endsWith('.md')).sort()) {
    const path = join(dir, 'sections', name);
    let raw = readFileSync(path, 'utf8');
    const { text, fixes } = autofix(raw, { files });
    if (fix && fixes.length) { writeFileSync(path, text); raw = text; }
    const ctx = newContext({ files, file: `sections/${name}`, roles: chapter.roles || {}, catalog });
    renderSection(raw, ctx);
    let id = null;
    try { id = String(splitFrontMatter(raw).meta.id ?? ''); } catch (e) { /* reported by the builder */ }
    const res = checkSection(raw, { source: extract ? byId.get(id) || null : null, files });
    const seen = new Set();
    const errors = [...ctx.errors.map((e) => ({ code: 'format', line: e.line, message: e.message })), ...res.errors]
      .filter((e) => { const k = e.code + e.message.replace(/^line \d+: /, ''); if (seen.has(k)) return false; seen.add(k); return true; });
    const warnings = [...res.warnings];
    if (!extract) warnings.splice(0, warnings.length, ...warnings.filter((w) => w.code !== 'source'));
    if (!fix && fixes.length) warnings.push({ code: 'fixable', line: null, message: `--fix would apply: ${fixes.join('; ')}` });
    results.push({ file: `sections/${name}`, id, fixed: fix ? fixes : [], errors, warnings, metrics: res.metrics });
  }
  return { source: srcFile && extract ? srcFile : null, results, ok: results.every((r) => !r.errors.length) };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = args.find((a, i) => !a.startsWith('--') && !['--source', '--json'].includes(args[i - 1]));
  if (!dir) { console.error('usage: node tools/validate.mjs <chapter-dir> [--source extract.json] [--fix] [--json report.json]'); return 2; }
  const rep = validateChapter(resolve(dir), { sourcePath: opt('--source') && resolve(opt('--source')), fix: args.includes('--fix') });
  if (!rep.source) console.log('(no source extract: format and file checks only)');
  console.log('section                      errors  warnings  copy%  coverage  words/source');
  for (const r of rep.results) {
    const m = r.metrics;
    console.log(`${r.file.padEnd(28)} ${String(r.errors.length).padStart(6)}  ${String(r.warnings.length).padStart(8)}  ${String(m.copy_overlap ?? '-').padStart(5)}  ${String(m.coverage ?? '-').padStart(8)}  ${m.words ?? '-'}/${m.source_words ?? '-'}`);
  }
  for (const r of rep.results) {
    for (const f of r.fixed) console.log(`${r.file}: fixed: ${f}`);
    for (const e of r.errors) console.log(`${r.file}${e.line ? `:${e.line}` : ''}: error [${e.code}] ${e.message}`);
    for (const w of r.warnings) console.log(`${r.file}${w.line ? `:${w.line}` : ''}: warning [${w.code}] ${w.message}`);
  }
  if (opt('--json')) writeFileSync(resolve(opt('--json')), JSON.stringify(rep, null, 2));
  return rep.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
