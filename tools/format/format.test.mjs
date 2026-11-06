import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildChapter, loadCatalog } from '../build.mjs';
import { catalogChapter } from '../catalog.mjs';
import { parseArgs, parseBlocks, parseRanges, parseSection } from './parse.mjs';
import { newContext, renderSection } from './render.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/demo', import.meta.url));

function render(body, files = {}) {
  const ctx = newContext({ files, file: 't.md' });
  const res = renderSection(`---\nid: "1.1"\ntitle: T\n---\n${body}`, ctx);
  return { html: res.html, errors: ctx.errors.map((e) => e.message), ctx };
}

test('args: variant, key=value and quoted values', () => {
  assert.deepEqual(parseArgs('note title="Two words" hl=8,11-12'), { variant: 'note', args: { title: 'Two words', hl: '8,11-12' } });
  assert.throws(() => parseArgs('a b'), /unexpected argument/);
});

test('ranges', () => {
  assert.deepEqual(parseRanges('8,11-13'), [8, 11, 12, 13]);
  assert.throws(() => parseRanges('x'), /bad line range/);
});

test('directives nest by fence length and report their lines', () => {
  const nodes = parseBlocks('intro\n\n::::tabs\n@ A\n:::code src=x\n:::\n@ B\nb\n::::\nafter');
  assert.deepEqual(nodes.map((n) => n.type + (n.name ? ':' + n.name : '')), ['md', 'directive:tabs', 'md']);
  assert.equal(nodes[1].line, 3);
  assert.match(nodes[1].body, /:::code src=x\n:::/);
});

test('an unclosed directive is an error with its line', () => {
  assert.throws(() => parseSection('---\nid: "1"\ntitle: x\n---\ntext\n:::quiz\n? q'), /line 6: :::quiz is never closed/);
});

test('code: missing file and highlight past the end are errors', () => {
  const ok = render(':::code src=a.yaml hl=2\n:::', { 'a.yaml': 'a: 1\nb: 2' });
  assert.deepEqual(ok.errors, []);
  assert.match(ok.html, /<div class="code" data-src="a.yaml" data-hl="2"><\/div>/);
  assert.deepEqual(render(':::code src=b.yaml\n:::').errors, ['code src "b.yaml" is not in the chapter\'s files/']);
  assert.match(render(':::code src=a.yaml hl=5\n:::', { 'a.yaml': 'x' }).errors[0], /past the end/);
});

test('term: $ lines become chips and the lines after them canned output', () => {
  const { html, ctx } = render(':::term catchup=12.2\n$ kubectl get ing\nNAME  HOSTS\n$ curl -k https://x\n:::');
  assert.equal((html.match(/class="cmd"/g) || []).length, 2);
  assert.match(html, /data-catchup="12.2"/);
  assert.deepEqual(ctx.canned, { 'kubectl get ing': 'NAME  HOSTS' });
});

test('quiz needs exactly one right answer and an explanation', () => {
  const good = render(':::quiz\n? Q\n- a\n+ b\n> because\n:::');
  assert.deepEqual(good.errors, []);
  assert.match(good.html, /<button class="opt" data-correct>b<\/button>/);
  const bad = render(':::quiz\n? Q\n+ a\n+ b\n:::');
  assert.deepEqual(bad.errors, ['quiz needs exactly one "+" option, found 2', 'quiz has no "> explanation" line']);
});

test('callout: one paragraph stays inline after the label; more becomes blocks', () => {
  assert.match(render(':::callout warn\nCareful.\n:::').html, /<aside class="callout warn"><b>Warning<\/b> Careful.<\/aside>/);
  assert.match(render(':::callout tip\nOne.\n\nTwo.\n:::').html, /<aside class="callout tip"><b>Tip<\/b> <p>One.<\/p>\n<p>Two.<\/p>/);
});

test('svg escape hatch: steps make a stepper; hex colours are rejected', () => {
  const s = render(':::diagram svg\n<svg viewBox="0 0 10 10"><rect class="n-svc"/></svg>\n---\nsteps: [one, two]\n:::');
  assert.match(s.html, /<figure class="diagram stepper"><svg[\s\S]*<ol class="steps"><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(render(':::diagram svg\n<svg><rect fill="#ff0000"/></svg>\n:::').errors[0], /hex colours/);
});

test('unknown directives and missing front matter are reported', () => {
  assert.match(render(':::sparkle\n:::').errors[0], /unknown directive :::sparkle/);
  const ctx = newContext();
  renderSection('no front matter', ctx);
  assert.deepEqual(ctx.errors.map((e) => e.message), ['front matter is missing "id"', 'front matter is missing "title"']);
});

test('the demo chapter builds into one self-contained page with no errors', () => {
  const res = buildChapter(FIXTURE);
  assert.deepEqual(res.errors, []);
  assert.equal(res.sections.length, 2);
  assert.ok(!/<script src=|<link rel="stylesheet"/.test(res.html), 'scripts and CSS are inlined');
  assert.ok(!/\{\{\w+\}\}/.test(res.html), 'no template placeholders left');
  assert.match(res.html, /window\.CHAPTER = \{"id":"demo","sections":\["s1-1","s1-2"\]/);
  assert.deepEqual(res.widgets, ['compare-scale']);
  assert.deepEqual(res.warnings, []);
  assert.match(res.html, /WIDGETS\.register\('compare-scale'/, 'used widget is included');
  assert.ok(!/WIDGETS\.register\('timeline'/.test(res.html), 'unused widgets are left out');
});

test('widget configs are checked against the catalog schema', () => {
  const catalog = loadCatalog();
  const r = (body) => {
    const ctx = newContext({ catalog, file: 't.md' });
    const out = renderSection(`---\nid: "1"\ntitle: T\n---\n${body}`, ctx);
    return { html: out.html, errors: ctx.errors.map((e) => e.message) };
  };
  assert.deepEqual(r(':::widget compare-scale\nitem: Service\nunit: LB\n:::').errors, []);
  assert.deepEqual(r(':::widget compare-scale\nitem: Service\nunits: LB\n:::').errors,
    ['widget compare-scale: config: missing "unit"', 'widget compare-scale: config: unknown field "units" (allowed: title, intro, item, unit, shared, left_title, right_title, n, cost, note)']);
  assert.match(r(':::widget sparkles\n:::').errors[0], /unknown widget "sparkles".*widget-request/);
  const req = r(':::widget-request\nname: page-table\nshows: virtual to physical translation\ninputs: address\nfallback: See the table below.\n:::');
  assert.deepEqual(req.errors, []);
  assert.match(req.html, /Interactive version requested/);
});

test('every catalog widget has its four files, and its example and skill snippets validate', () => {
  const catalog = loadCatalog();
  const dir = fileURLToPath(new URL('../../engine/widgets', import.meta.url));
  for (const name of readdirSync(dir)) {
    for (const f of ['widget.js', 'schema.json', 'example.yaml', 'skill.md']) assert.ok(existsSync(join(dir, name, f)), `${name}/${f} missing`);
    const example = readFileSync(join(dir, name, 'example.yaml'), 'utf8');
    const skill = readFileSync(join(dir, name, 'skill.md'), 'utf8');
    const snippets = [`:::widget ${name}\n${example}\n:::`, ...[...skill.matchAll(/```\n(:::widget [\s\S]*?\n:::)\n```/g)].map((m) => m[1])];
    assert.ok(snippets.length >= 2, `${name}/skill.md has no :::widget example`);
    for (const s of snippets) {
      const ctx = newContext({ catalog, file: `${name}` });
      renderSection(`---\nid: "1"\ntitle: T\n---\n${s}`, ctx);
      assert.deepEqual(ctx.errors.map((e) => e.message), [], `${name}: ${s.slice(0, 60)}`);
    }
  }
});

test('every diagram and widget example in pipeline/skills builds without errors', () => {
  const catalog = loadCatalog();
  const dir = fileURLToPath(new URL('../../pipeline/skills', import.meta.url));
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/```\n(:::(?:diagram (?:flow|sequence)|widget [\w-]+)[\s\S]*?\n:::)\n```/g)) {
      const ctx = newContext({ catalog, file: f, roles: {} });
      renderSection(`---\nid: "1"\ntitle: T\n---\n${m[1]}`, ctx);
      assert.deepEqual(ctx.errors.map((e) => e.message), [], `${f}: ${m[1].slice(0, 50)}`);
      n++;
    }
  }
  assert.ok(n >= 9, `only ${n} examples found`);
});

test('the catalog page builds with no errors', () => {
  const dir = join(tmpdir(), `itb-catalog-${process.pid}`);
  catalogChapter(dir);
  const res = buildChapter(dir);
  assert.deepEqual(res.errors, []);
  assert.equal(res.widgets.length, readdirSync(fileURLToPath(new URL('../../engine/widgets', import.meta.url))).length);
});

test('canned output for a command the shell plugin simulates is dropped with a warning', () => {
  const dir = join(tmpdir(), `itb-canned-${process.pid}`);
  mkdirSync(join(dir, 'sections'), { recursive: true });
  writeFileSync(join(dir, 'chapter.yaml'), 'id: t\ntitle: T\nshell: { plugin: kubectl-ingress }\n');
  writeFileSync(join(dir, 'sections', '1.md'), '---\nid: "1"\ntitle: T\n---\n:::term\n$ kubectl get ing\nNAME\n$ psql -c "select 1"\n 1\n:::\n');
  const res = buildChapter(dir);
  assert.deepEqual(Object.keys(res.canned), ['psql -c "select 1"']);
  assert.match(res.warnings[0], /canned output for "kubectl get ing" is ignored/);
});
