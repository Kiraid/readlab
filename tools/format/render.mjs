// Content format -> the engine's HTML conventions (see reference/kia-ch13/AUTHORING.md).
// Writers never produce this HTML; they write Markdown + directives and this file owns the markup.
import { Marked } from 'marked';
import { parse as parseYaml } from 'yaml';
import { normalizeFlow, normalizeSequence } from './diagram.mjs';
import { FormatError, parseBlocks, parseRanges, parseSection } from './parse.mjs';
import { validate } from './schema.mjs';

const marked = new Marked({ gfm: true });

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mdBlock(text) {
  return marked.parse(text)
    .replace(/<table>/g, '<table class="grid">')
    .replace(/<h[1-3]>/g, '<h4>').replace(/<\/h[1-3]>/g, '</h4>'); // section headings come from front matter
}
const mdInline = (text) => marked.parseInline(String(text ?? '').trim());

export function slug(id) {
  return 's' + String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const CALLOUTS = {
  note: ['note', 'Note'], tip: ['tip', 'Tip'], warn: ['warn', 'Warning'], warning: ['warn', 'Warning'],
  definition: ['note', 'Definition'], important: ['warn', 'Important'], caution: ['warn', 'Caution'],
  sidebar: ['note', null],
};

function yamlBody(d, ctx) {
  try {
    return parseYaml(d.body) ?? {};
  } catch (e) {
    ctx.error(`:::${d.name} body is not valid YAML: ${e.message.split('\n')[0]}`, d.line);
    return {};
  }
}

const RENDER = {
  callout(d, ctx) {
    const [cls, label] = CALLOUTS[d.variant || 'note'] || (ctx.error(`unknown callout type "${d.variant}"`, d.line), CALLOUTS.note);
    const title = d.args.title ? esc(d.args.title) : label;
    const lead = title ? `<b>${title}</b> ` : '';
    const nodes = parseBlocks(d.body, d.bodyLine - 1);
    // one paragraph: keep it inline after the label, as the engine's callout CSS expects
    if (nodes.length === 1 && nodes[0].type === 'md' && !/\n\s*\n|^\s*([-*+]|\d+\.|\|)\s/m.test(nodes[0].text.trim())) {
      return `<aside class="callout ${cls}">${lead}${mdInline(nodes[0].text)}</aside>`;
    }
    return `<aside class="callout ${cls}">${lead}${renderNodes(nodes, ctx)}</aside>`;
  },

  code(d, ctx) {
    if (d.args.src) {
      const file = ctx.files[d.args.src];
      if (file === undefined) ctx.error(`code src "${d.args.src}" is not in the chapter's files/`, d.line);
      const hl = d.args.hl ? parseRanges(d.args.hl) : [];
      const n = file === undefined ? Infinity : file.split('\n').length;
      const bad = hl.filter((k) => k > n);
      if (bad.length) ctx.error(`hl line(s) ${bad.join(',')} past the end of ${d.args.src} (${n} lines)`, d.line);
      return `<div class="code" data-src="${esc(d.args.src)}"${d.args.hl ? ` data-hl="${esc(d.args.hl)}"` : ''}></div>`;
    }
    return RENDER.snippet({ ...d, variant: d.variant || d.args.lang || 'text' }, ctx);
  },

  snippet(d) {
    return `<pre class="snippet" data-lang="${esc(d.variant || 'text')}">${esc(d.body)}</pre>`;
  },

  // Lines starting with "$ " are commands; the lines after one are its canned output (used when the
  // shell plugin doesn't know the command). Without any "$ " lines, every line is a command.
  term(d, ctx) {
    const lines = d.body.split('\n');
    const dollar = lines.some((l) => l.startsWith('$ '));
    const cmds = [];
    for (const l of lines) {
      if (dollar ? l.startsWith('$ ') : l.trim()) cmds.push({ cmd: (dollar ? l.slice(2) : l).trim(), out: [] });
      else if (dollar && cmds.length) cmds[cmds.length - 1].out.push(l);
    }
    if (!cmds.length) ctx.error(':::term has no commands', d.line);
    for (const c of cmds) {
      const out = c.out.join('\n').replace(/\s+$/, '');
      if (out) ctx.canned[c.cmd] = out;
    }
    const attrs = [d.args.catchup && `data-catchup="${esc(d.args.catchup)}"`, d.args.title && `data-title="${esc(d.args.title)}"`]
      .filter(Boolean).join(' ');
    return `<div class="term"${attrs ? ' ' + attrs : ''}>\n${cmds.map((c) => `  <code class="cmd">${esc(c.cmd)}</code>`).join('\n')}\n</div>`;
  },

  // ? question / - wrong / + right / > explanation (continuation lines are joined)
  quiz(d, ctx) {
    let q = '';
    const opts = [];
    let explain = '';
    let last = null;
    for (const raw of d.body.split('\n')) {
      const l = raw.trim();
      if (!l) continue;
      const m = /^([?+\->])\s*(.*)$/.exec(l);
      if (m) {
        if (m[1] === '?') { q = m[2]; last = 'q'; }
        else if (m[1] === '>') { explain = m[2]; last = 'x'; }
        else { opts.push({ text: m[2], ok: m[1] === '+' }); last = 'o'; }
      } else if (last === 'q') q += ' ' + l;
      else if (last === 'x') explain += ' ' + l;
      else if (last === 'o') opts[opts.length - 1].text += ' ' + l;
    }
    const right = opts.filter((o) => o.ok).length;
    if (!q) ctx.error('quiz has no "? question" line', d.line);
    if (opts.length < 2) ctx.error('quiz needs at least two options', d.line);
    if (right !== 1) ctx.error(`quiz needs exactly one "+" option, found ${right}`, d.line);
    if (!explain) ctx.error('quiz has no "> explanation" line', d.line);
    return `<div class="quiz">\n  <p class="q">${mdInline(q)}</p>\n${opts.map((o) =>
      `  <button class="opt"${o.ok ? ' data-correct' : ''}>${mdInline(o.text)}</button>`).join('\n')}\n  <p class="explain">${mdInline(explain)}</p>\n</div>`;
  },

  // "@ Label" lines start a panel; panel bodies are Markdown with nested directives.
  tabs(d, ctx) {
    const panels = [];
    const lines = d.body.split('\n');
    lines.forEach((l, k) => {
      const m = /^@\s+(.+)$/.exec(l);
      if (m) panels.push({ label: m[1].trim(), lines: [], line: d.bodyLine + k + 1 });
      else if (panels.length) panels[panels.length - 1].lines.push(l);
      else if (l.trim()) ctx.error('tabs content before the first "@ Label" line', d.bodyLine + k);
    });
    if (panels.length < 2) ctx.error('tabs need at least two "@ Label" panels', d.line);
    const id = (i) => `t${ctx.tabsSeq}-${i}`;
    ctx.tabsSeq++;
    return `<div class="tabset">\n  <div class="tabs">${panels.map((p, i) => `<button data-tab="${id(i)}">${esc(p.label)}</button>`).join('')}</div>\n` +
      panels.map((p, i) => `  <div class="tab-panel" data-tab="${id(i)}">${renderNodes(parseBlocks(p.lines.join('\n'), p.line - 1), ctx)}</div>`).join('\n') +
      '\n</div>';
  },

  recap(d, ctx) {
    return `<div class="recap"><b>${esc(d.args.title || 'Takeaways')}</b>${mdBlock(d.body)}</div>`;
  },

  // flow / sequence: DSL source for the runtime renderer (step 3b). svg: hand-written escape hatch,
  // optionally followed by a "---" line and YAML { caption, steps }.
  diagram(d, ctx) {
    const kind = d.variant || 'flow';
    ctx.figures++;
    const caption = (c) => (c ? `<figcaption>${mdInline(c)}</figcaption>` : '');
    if (kind === 'svg') {
      const [svg, metaText] = d.body.split(/^---\s*$/m);
      let meta = {};
      if (metaText) try { meta = parseYaml(metaText) ?? {}; } catch (e) { ctx.error(`diagram svg meta: ${e.message.split('\n')[0]}`, d.line); }
      if (!/^\s*<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg)) ctx.error('diagram svg body must be a single <svg>…</svg>', d.line);
      if (/\b(fill|stroke)="#|style="[^"]*#[0-9a-f]{3}/i.test(svg)) ctx.error('diagram svg uses hex colours; use the role classes', d.line);
      const steps = Array.isArray(meta.steps) ? meta.steps : [];
      const cls = steps.length ? 'diagram stepper' : 'diagram';
      const ol = steps.length ? `<ol class="steps">${steps.map((s) => `<li>${mdInline(s)}</li>`).join('')}</ol>` : '';
      return `<figure class="${cls}">${svg.trim()}${ol}${caption(meta.caption || d.args.caption)}</figure>`;
    }
    if (kind !== 'flow' && kind !== 'sequence') { ctx.error(`unknown diagram type "${kind}" (flow, sequence, svg)`, d.line); return ''; }
    const raw = yamlBody(d, ctx);
    const err = (m) => ctx.error(`diagram ${kind}: ${m}`, d.line);
    const spec = kind === 'flow' ? normalizeFlow(raw, { aliases: ctx.roles, err }) : normalizeSequence(raw, { aliases: ctx.roles, err });
    const cap = spec.caption || d.args.caption;
    return `<figure class="diagram dsl" data-dsl="${esc(kind)}"><script type="application/json">${JSON.stringify(spec).replace(/</g, '\\u003c')}</script>${caption(cap)}</figure>`;
  },

  // Catalog widget: the variant names it, the YAML body configures it. Configs are checked against
  // engine/widgets/<name>/schema.json; any "diagram:" field inside is a flow diagram and gets normalised.
  widget(d, ctx) {
    const name = d.variant;
    if (!name) { ctx.error('widget needs a name, e.g. ":::widget compare-scale"', d.line); return ''; }
    const cfg = d.body.trim() ? yamlBody(d, ctx) : {};
    if (ctx.catalog) {
      if (!ctx.catalog[name]) ctx.error(`unknown widget "${name}" (catalog: ${Object.keys(ctx.catalog).join(', ')}); if nothing fits, use :::widget-request`, d.line);
      else for (const m of validate(cfg, ctx.catalog[name])) ctx.error(`widget ${name}: ${m}`, d.line);
    }
    const walk = (v, path) => {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
      if (v && typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) {
          out[k] = k === 'diagram' && x && typeof x === 'object'
            ? normalizeFlow(x, { aliases: ctx.roles, err: (m) => ctx.error(`widget ${name} ${path}.diagram: ${m}`, d.line) })
            : walk(x, `${path}.${k}`);
        }
        return out;
      }
      return v;
    };
    ctx.widgets.add(name);
    return `<div class="widget" data-widget="${esc(name)}" data-config="${esc(JSON.stringify(walk(cfg, 'config')))}"></div>`;
  },

  // Nothing in the catalog fits: record the request and show a plain fallback so the build still works.
  // The requests are collected per run and built by a separate widget-builder step.
  'widget-request'(d, ctx) {
    const req = yamlBody(d, ctx);
    for (const k of ['name', 'shows', 'inputs', 'fallback']) if (!req[k]) ctx.error(`widget-request needs "${k}"`, d.line);
    ctx.requests.push({ ...req, file: ctx.file, line: d.line });
    return `<aside class="callout note"><b>Interactive version requested</b> ${mdInline(req.fallback || req.shows || '')}</aside>`;
  },
};

export const DIRECTIVES = Object.keys(RENDER);

export function renderNodes(nodes, ctx) {
  return nodes.map((n) => {
    if (n.type === 'md') return mdBlock(n.text);
    const fn = RENDER[n.name];
    if (!fn) {
      ctx.error(`unknown directive :::${n.name} (known: ${DIRECTIVES.join(', ')})`, n.line);
      return `<aside class="callout warn"><b>Unknown block</b> :::${esc(n.name)}</aside>`;
    }
    return fn(n, ctx);
  }).join('\n');
}

export function newContext({ files = {}, file = '', roles = {}, catalog = null } = {}) {
  const errors = [];
  return {
    files, file, roles, catalog, errors, canned: {}, widgets: new Set(), requests: [], figures: 0, tabsSeq: 0,
    error(message, line) { errors.push({ file, line, message }); },
  };
}

/** Render one section file. Returns { id, slug, html, meta }. Errors accumulate in ctx.errors. */
export function renderSection(text, ctx) {
  let parsed;
  try {
    parsed = parseSection(text);
  } catch (e) {
    ctx.error(e.message.replace(/^line \d+: /, ''), e.line);
    return { id: null, slug: null, html: '', meta: {} };
  }
  const { meta, nodes } = parsed;
  for (const k of ['id', 'title']) if (!meta[k]) ctx.error(`front matter is missing "${k}"`, 1);
  const level = meta.level || (String(meta.id).split('.').length <= 2 ? 'major' : 'sub');
  const h = level === 'major' ? 'h2' : 'h3';
  const pages = meta.pages ? `<p class="book-pages">book pp. ${esc(String(meta.pages).replace('-', '–'))}</p>` : '';
  const id = slug(meta.id);
  const html = `<section class="${level}" id="${id}">\n<${h}><span class="num">${esc(meta.id)}</span> ${mdInline(meta.title)}</${h}>\n${pages}\n` +
    renderNodes(nodes, ctx) + '\n</section>\n';
  return { id: meta.id, slug: id, html, meta };
}
