// Content format parser: Markdown with ::: directive blocks.
//
//   ---                      front matter (YAML): id, title, level, pages
//   ---
//   Plain Markdown.
//   :::name variant key=value key="quoted value"
//   body (Markdown, YAML or raw, depending on the directive)
//   :::
//
// Directives nest by fence length, as in remark-directive: an outer block uses more colons
// (::::tabs) than the blocks inside it (:::code). A close line is the same number of colons alone.
import { parse as parseYaml } from 'yaml';

const OPEN = /^(:{3,})([a-z][\w-]*)(?:\s+(.*))?$/;

export class FormatError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.line = line;
  }
}

/** `note title="A b" hl=8,11-12` -> { variant: 'note', args: { title: 'A b', hl: '8,11-12' } } */
export function parseArgs(s = '') {
  const args = {};
  let variant = null;
  const re = /([\w-]+)=("([^"]*)"|'([^']*)'|(\S+))|("([^"]*)"|\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) args[m[1]] = m[3] ?? m[4] ?? m[5];
    else if (variant === null) variant = m[7] ?? m[6];
    else throw new FormatError(`unexpected argument "${m[6]}" (use key=value)`);
  }
  return { variant, args };
}

/** Split front matter from the body. */
export function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text, offset: 0 };
  return { meta: parseYaml(m[1]) ?? {}, body: text.slice(m[0].length), offset: m[0].split('\n').length - 1 };
}

/**
 * Parse a body into nodes:
 *   { type: 'md', text, line }
 *   { type: 'directive', name, variant, args, body, line, fence }
 * Directive bodies stay raw text; each renderer decides how to read its body
 * (Markdown with nested directives, YAML, or verbatim lines).
 */
export function parseBlocks(text, lineOffset = 0) {
  const lines = text.split(/\r?\n/);
  const nodes = [];
  let md = [];
  let mdStart = 1;
  const flushMd = () => {
    if (md.join('').trim()) nodes.push({ type: 'md', text: md.join('\n'), line: lineOffset + mdStart });
    md = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    if (!open) {
      if (!md.length) mdStart = i + 1;
      md.push(lines[i]);
      continue;
    }
    flushMd();
    const fence = open[1];
    const closeRe = new RegExp(`^${fence}\\s*$`);
    const sameOpen = new RegExp(`^${fence}[a-z]`);
    let depth = 1;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (sameOpen.test(lines[j]) && !lines[j].startsWith(fence + ':')) depth++;
      else if (closeRe.test(lines[j]) && --depth === 0) break;
    }
    if (j >= lines.length) throw new FormatError(`:::${open[2]} is never closed (expected a line "${fence}")`, lineOffset + i + 1);
    let parsed;
    try { parsed = parseArgs(open[3]); } catch (e) { throw new FormatError(e.message, lineOffset + i + 1); }
    nodes.push({ type: 'directive', name: open[2], variant: parsed.variant, args: parsed.args,
                 body: lines.slice(i + 1, j).join('\n'), line: lineOffset + i + 1, bodyLine: lineOffset + i + 2, fence });
    i = j;
    mdStart = j + 2;
  }
  flushMd();
  return nodes;
}

/** Parse a whole section file. */
export function parseSection(text) {
  const { meta, body, offset } = splitFrontMatter(text);
  return { meta, nodes: parseBlocks(body, offset) };
}

/** "8,11-12" -> [8, 11, 12] */
export function parseRanges(s) {
  if (!s) return [];
  const out = [];
  for (const part of String(s).split(',')) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new FormatError(`bad line range "${part}"`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let k = a; k <= b; k++) out.push(k);
  }
  return out;
}
