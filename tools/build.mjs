#!/usr/bin/env node
// Build a chapter into ONE self-contained HTML file (opens with a double-click, no server).
//
//   node tools/build.mjs <chapter-dir> [--out <dir>] [--allow-errors] [--split]
//
// --split also writes the paged build: assets/ (one cached CSS + JS bundle), parts/NN.html (a few sections each),
// manifest.json (parts and their sections) and search.json (each section's plain text, for the app's search).
//
// <chapter-dir>/chapter.yaml   page chrome + shell + role aliases (see tools/fixtures/demo/chapter.yaml)
// <chapter-dir>/sections/*.md  sections in file-name order (Markdown + ::: directives)
// <chapter-dir>/files/*        virtual files for code blocks and the shell
//
// Writes <out>/index.html, plus <out>/widget-requests.json when a section asked for a widget that
// isn't in the catalog yet.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { esc, newContext, renderSection } from './format/render.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENGINE = join(ROOT, 'engine');
const CORE_SCRIPTS = ['js/yaml.js', 'js/terminal.js', 'js/core.js', 'js/diagram.js'];
const STYLES = ['css/style.css', 'css/engine.css'];

export function readFiles(dir) {
  const files = {};
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isFile()) files[name] = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  }
  return files;
}

/** Widget catalog: engine/widgets/<name>/{widget.js, schema.json, ...} -> { name: schema } */
export function loadCatalog() {
  const dir = join(ENGINE, 'widgets');
  const catalog = {};
  if (!existsSync(dir)) return catalog;
  for (const name of readdirSync(dir)) {
    const schema = join(dir, name, 'schema.json');
    if (existsSync(schema) && existsSync(join(dir, name, 'widget.js'))) catalog[name] = JSON.parse(readFileSync(schema, 'utf8'));
  }
  return catalog;
}

export function shellPlugin(plugin) {
  const dir = join(ENGINE, 'shells', plugin);
  const manifest = join(dir, 'manifest.json');
  if (!existsSync(manifest)) throw new Error(`unknown shell plugin "${plugin}" (engine/shells/${plugin}/manifest.json not found)`);
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  return { scripts: m.scripts.map((s) => join(dir, s)), handles: m.handles || [] };
}

const inlineScript = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

export function buildChapter(dir) {
  const chapter = parseYaml(readFileSync(join(dir, 'chapter.yaml'), 'utf8')) ?? {};
  const files = readFiles(join(dir, 'files'));
  const catalog = loadCatalog();
  const roles = chapter.roles || {};
  const shell = { plugin: 'basic', ...(chapter.shell || {}) };
  const sectionDir = join(dir, 'sections');
  const names = readdirSync(sectionDir).filter((n) => n.endsWith('.md')).sort();
  const errors = [];
  const canned = {};
  const widgets = new Set();
  const requests = [];
  const sections = [];
  const seen = new Map();
  for (const name of names) {
    const ctx = newContext({ files, file: `sections/${name}`, roles, catalog });
    const s = renderSection(readFileSync(join(sectionDir, name), 'utf8'), ctx);
    if (s.slug && seen.has(s.slug)) ctx.error(`section id ${s.id} is also used by ${seen.get(s.slug)}`, 1);
    if (s.slug) seen.set(s.slug, name);
    errors.push(...ctx.errors);
    Object.assign(canned, ctx.canned);
    ctx.widgets.forEach((w) => widgets.add(w));
    requests.push(...ctx.requests);
    sections.push(s);
  }

  const ids = new Set(sections.map((s) => s.slug));
  for (const s of sections) {
    for (const m of s.html.matchAll(/href="#([^"]+)"/g)) {
      if (!ids.has(m[1])) errors.push({ file: s.meta.id, line: null, message: `link to #${m[1]}, which is not a section id` });
    }
  }

  let plug = { scripts: [], handles: [] };
  try { plug = shellPlugin(shell.plugin); } catch (e) { errors.push({ file: 'chapter.yaml', line: null, message: e.message }); }
  const warnings = [];
  for (const cmd of Object.keys(canned)) {
    if (plug.handles.includes(cmd.split(/\s+/)[0])) {
      warnings.push(`canned output for "${cmd}" is ignored: the ${shell.plugin} shell simulates "${cmd.split(/\s+/)[0]}" itself (drop the output lines)`);
      delete canned[cmd];
    }
  }
  const data = {
    id: chapter.id || basename(dir), sections: sections.map((s) => s.slug), roles,
    shell: { user: shell.user, dir: shell.dir, title: shell.title, run_file: shell.run_file, handles: plug.handles },
  };
  const code = [
    `window.CHAPTER = ${JSON.stringify(data)};\nwindow.FILES = ${JSON.stringify(files, null, 1)};\nwindow.CANNED = ${JSON.stringify(canned, null, 1)};`,
    ...[
      ...CORE_SCRIPTS.map((p) => join(ENGINE, p)),
      ...[...widgets].filter((w) => catalog[w]).sort().map((w) => join(ENGINE, 'widgets', w, 'widget.js')),
      ...plug.scripts,
      join(ENGINE, 'js', 'app.js'),
    ].map((p) => readFileSync(p, 'utf8')),
  ];
  const scripts = code.map(inlineScript).join('\n  ');
  const css = STYLES.map((p) => readFileSync(join(ENGINE, p), 'utf8')).join('\n');

  const template = readFileSync(join(ENGINE, 'template.html'), 'utf8');
  const fields = {
    title: esc(chapter.title || 'Chapter'),
    description: esc(chapter.description || ''),
    brand_mark: chapter.brand_mark || '◆',
    brand_sub: esc(chapter.brand_sub || ''),
    eyebrow: esc(chapter.eyebrow || ''),
    headline: chapter.headline || esc(chapter.title || ''),
    lede: chapter.lede || '',
    hero: chapter.hero || '',
    footer: chapter.footer || '',
    shell_title: esc(shell.title || `${shell.user || 'you@book'}: ${shell.dir || '~'}`),
    styles: `<style>\n${css}\n</style>`,
    sections: '\n' + sections.map((s) => s.html).join('\n'),
    scripts,
  };
  const fill = (f) => template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in f ? f[k] : m));
  const html = fill(fields);
  return { html, errors, warnings, sections, widgets: [...widgets], canned, requests, split: { fill, fields, css, code } };
}

const PART_WORDS = 2000; // a part is roughly ten minutes of reading
const MIN_PART_WORDS = 700;
const textOf = (html) => html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

/** Group sections into parts: a major section starts a part once the current one has some length, and a long run
 *  of subsections is cut once it passes the target. */
export function groupParts(sections) {
  const parts = [];
  let cur = null;
  for (const s of sections) {
    const major = s.html.startsWith('<section class="major"');
    if (!cur || (cur.words >= MIN_PART_WORDS && (major || cur.words >= PART_WORDS || cur.words + s.words > 1.6 * PART_WORDS))) {
      cur = { sections: [], words: 0 };
      parts.push(cur);
    }
    cur.sections.push(s);
    cur.words += s.words;
  }
  return parts;
}

/** The paged build: one cached CSS and JS bundle for the chapter, a small HTML file per part, and what the app needs
 *  to list, paginate and search them (manifest.json, search.json). */
export function writeSplit(res, out) {
  const { fill, fields, css, code } = res.split;
  const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
  const js = code.join('\n;\n'); // one classic script: the engine's files share top-level names, as inline scripts do
  const names = { css: `chapter.${hash(css)}.css`, js: `chapter.${hash(js)}.js` };
  mkdirSync(join(out, 'assets'), { recursive: true });
  mkdirSync(join(out, 'parts'), { recursive: true });
  writeFileSync(join(out, 'assets', names.css), css);
  writeFileSync(join(out, 'assets', names.js), js);
  const secs = res.sections.filter((s) => s.slug).map((s) => {
    const text = textOf(s.html);
    return { ...s, text, words: text ? text.split(' ').length : 0 };
  });
  const parts = groupParts(secs);
  const manifest = { version: 1, assets: names, parts: [] };
  const search = [];
  parts.forEach((p, i) => {
    const n = i + 1;
    const file = `parts/${String(n).padStart(2, '0')}.html`;
    const first = n === 1;
    const last = n === parts.length;
    const html = fill({
      ...fields,
      styles: `<link rel="stylesheet" href="../assets/${names.css}">`,
      scripts: `<script src="../assets/${names.js}"></script>`,
      sections: '\n' + p.sections.map((s) => s.html).join('\n'),
      ...(first ? {} : { eyebrow: '', headline: '', lede: '', hero: '' }),
      ...(last ? {} : { footer: '' }),
    }).replace('<header class="hero">', first ? '<header class="hero">' : '<header class="hero" hidden>');
    writeFileSync(join(out, file), html);
    manifest.parts.push({
      n, file, words: p.words,
      sections: p.sections.map((s) => ({ id: s.slug, num: String(s.meta.id ?? ''), title: String(s.meta.title ?? ''),
        level: s.html.startsWith('<section class="major"') ? 'major' : 'sub' })),
    });
    for (const s of p.sections) search.push({ part: n, id: s.slug, num: String(s.meta.id ?? ''), title: String(s.meta.title ?? ''), text: s.text });
  });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(join(out, 'search.json'), JSON.stringify(search));
  return manifest;
}

function main(argv) {
  const args = argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  if (!dir) {
    console.error('usage: node tools/build.mjs <chapter-dir> [--out <dir>] [--allow-errors] [--split]');
    return 2;
  }
  const oi = args.indexOf('--out');
  const out = resolve(oi >= 0 ? args[oi + 1] : join(dir, 'dist'));
  const res = buildChapter(resolve(dir));
  for (const e of res.errors) console.error(`${e.file}${e.line ? `:${e.line}` : ''}: ${e.message}`);
  for (const w of res.warnings) console.error(`warning: ${w}`);
  if (res.errors.length && !args.includes('--allow-errors')) {
    console.error(`${res.errors.length} error(s); nothing written (use --allow-errors to write anyway)`);
    return 1;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), res.html);
  if (res.requests.length) writeFileSync(join(out, 'widget-requests.json'), JSON.stringify(res.requests, null, 2));
  if (args.includes('--split')) console.log(`split into ${writeSplit(res, out).parts.length} part(s)`);
  console.log(`${basename(resolve(dir))}: ${res.sections.length} sections, ${Object.keys(res.canned).length} canned commands, ` +
    `widgets: ${res.widgets.join(', ') || 'none'}${res.requests.length ? `, ${res.requests.length} widget request(s)` : ''} -> ${join(out, 'index.html')} (${Math.round(res.html.length / 1024)} KB)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
