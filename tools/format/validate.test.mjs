import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { scoreOutput } from '../eval-score.mjs';
import { validateChapter } from '../validate.mjs';
import { autofix } from './autofix.mjs';
import { checkSection, copyRuns, distinctiveTokens, paragraphCoverage, strayNumbers, words } from './checks.mjs';
import { parseSection } from './parse.mjs';

const FIX = fileURLToPath(new URL('../fixtures/validate', import.meta.url));

function chapterWith(kind) {
  const dir = join(tmpdir(), `itb-validate-${kind}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'sections'), { recursive: true });
  for (const f of ['chapter.yaml', 'source.json', 'files']) cpSync(join(FIX, f), join(dir, f), { recursive: true });
  cpSync(join(FIX, kind), join(dir, 'sections'), { recursive: true });
  return dir;
}
const codes = (list) => list.map((x) => x.code);

test('copy runs: a shared 8+ word run is found, the preview is at most six words', () => {
  const src = 'the proxy connects to the pod directly and never uses the cluster address';
  const out = 'In short, the proxy connects to the pod directly and never uses it.';
  const { runs, overlap } = copyRuns(out, src);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].len, 10);
  assert.equal(runs[0].preview, 'the proxy connects to the pod …');
  assert.ok(overlap > 0);
  assert.deepEqual(copyRuns('the proxy talks to pods', src).runs, []);
});

test('stray numbers skip line references, small numbers and numbers the source has', () => {
  assert.deepEqual(strayNumbers('Line 12 sets port 8080; lines 14–15 too; it started in 2014 with 3 nodes.', 'port 8080', ''), ['2014']);
  assert.deepEqual(words("It's the API's v1.2 field"), ['its', 'the', 'apis', 'v1.2', 'field']);
});

test('autofix repairs the simple mistakes and the result parses', () => {
  const raw = readFileSync(join(FIX, 'bad', '01-bad.md'), 'utf8');
  const { text, fixes } = autofix(raw, { files: { 'app.yaml': '' } });
  assert.deepEqual(fixes, ['front matter id quoted', 'body headings turned into ####', 'quiz markers normalised',
    'terminal prompts normalised', 'closed an unclosed directive (:::)']);
  assert.doesNotThrow(() => parseSection(text));
  assert.match(text, /^id: "1\.1"$/m);
  assert.match(text, /^\+ whether the pod gets traffic$/m);
  assert.match(text, /^\$ kubectl get pods$/m);
});

test('a good section passes against its source', () => {
  const rep = validateChapter(chapterWith('good'));
  const r = rep.results[0];
  assert.deepEqual(r.errors, []);
  assert.equal(rep.ok, true);
  assert.equal(r.metrics.copy_overlap, 0);
  assert.ok(r.metrics.coverage >= 80, `coverage ${r.metrics.coverage}`);
  assert.deepEqual(codes(r.warnings), []);
});

test('a broken section: without --fix only the parse error shows; with --fix the real problems do', () => {
  const before = validateChapter(chapterWith('bad'));
  assert.equal(before.ok, false);
  assert.deepEqual(codes(before.results[0].errors), ['format']);
  assert.match(before.results[0].errors[0].message, /never closed/);
  assert.ok(codes(before.results[0].warnings).includes('fixable'));

  const after = validateChapter(chapterWith('bad'), { fix: true });
  const r = after.results[0];
  assert.equal(r.fixed.length, 5);
  assert.deepEqual([...new Set(codes(r.errors))].sort(), ['copy', 'files', 'listing']);
  assert.match(r.errors.find((e) => e.code === 'listing').message, /listing 1\.1 \(app\.yaml\) is not shown/);
  assert.match(r.errors.find((e) => e.code === 'files').message, /"web\.yaml", which is not in the chapter's files/);
  const w = Object.fromEntries(r.warnings.map((x) => [x.code, x.message]));
  assert.match(w.numbers, /2014/);
  assert.match(w.numbers, /5000/);
  assert.match(w.commands, /kubectl apply -f app\.yaml/);
  assert.match(w.inventory, /table|figure/);
});

test('eval scorer: must checks pass/fail and the soft score reflects what the section uses', () => {
  const dir = join(tmpdir(), `itb-evalcase-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'out'), { recursive: true });
  cpSync(join(FIX, 'files'), join(dir, 'files'), { recursive: true });
  cpSync(join(FIX, 'source.json'), join(dir, 'source.json'));
  writeFileSync(join(dir, 'case.yaml'), 'id: fixture\ntitle: Running the web app\nshell: basic\nbrief: "Teach it at the length of the source."\nexpect: { visual_min: 1, quiz_min: 1 }\n');
  const good = scoreOutput(dir, join(FIX, 'good', '01-good.md'));
  assert.equal(good.pass, true);
  assert.deepEqual(good.must, { builds: true, no_copy: true, listings_shown: true, files_exist: true });
  assert.equal(good.should.invited_widget, undefined); // using a suggested widget is no longer scored
  assert.ok(good.score >= 60, `score ${good.score}`);
  assert.equal(good.should.length, 1); // 111% of the source's prose
  const thin = scoreOutput(dir, join(FIX, 'thin', '01-thin.md'));
  assert.ok(thin.should.length < 0.5, `length ${thin.should.length}`);
  const bad = scoreOutput(dir, join(FIX, 'bad', '01-bad.md'));
  assert.equal(bad.pass, false);
  assert.equal(bad.must.no_copy, false);
  assert.equal(bad.must.listings_shown, false);
});

test('autofix splits a quiz block with several questions; headings are not copy-checked', () => {
  const quiz = ':::quiz\n? One?\n- a\n+ b\n> why\n\n? Two?\n+ c\n- d\n> because\n:::\n';
  const { text, fixes } = autofix(`---\nid: "1"\ntitle: T\n---\n${quiz}`);
  assert.ok(fixes.includes('quiz blocks split one question each'));
  assert.equal((text.match(/^:::quiz$/gm) || []).length, 2);
  const src = { blocks: [{ kind: 'subheading', text: 'Changing the ports exposed by the service object today', meta: {} }], features: {} };
  const r = checkSection('---\nid: "1"\ntitle: T\n---\n#### Changing the ports exposed by the service object today\n\nOwn words here.\n', { source: src });
  assert.equal(r.errors.filter((e) => e.code === 'copy').length, 0);
});

test('distinctive tokens: numbers, code, names and rarer words; single digits and everyday words are not', () => {
  const toks = distinctiveTokens('The `web` pod in PostgreSQL listens on port 8080 with 3 replicas, which protects users.');
  const keys = toks.map((t) => `${t.kind}:${t.key}`);
  assert.ok(keys.includes('code:web'));
  assert.ok(keys.includes('number:8080'));
  assert.ok(keys.includes('term:postgre'));
  assert.ok(keys.includes('word:replica'));
  assert.ok(!keys.some((k) => k.endsWith(':3') || k.endsWith(':which')));
});

test('paragraph coverage: a section that drops a source paragraph gets a warning quoting at most six words', () => {
  const r = validateChapter(chapterWith('thin')).results[0];
  const paras = r.warnings.filter((w) => w.code === 'paragraph');
  assert.ok(paras.length >= 1);
  const missing = paras.find((w) => /para 3\/4/.test(w.message));
  assert.ok(missing, paras.map((w) => w.message).join('\n'));
  const quoted = missing.message.match(/\("([^"]*)"\)/)[1].replace(' …', '');
  assert.ok(quoted.split(' ').length <= 6, quoted);
  assert.ok(r.metrics.paragraphs_missing >= 1 && r.metrics.paragraphs_judged === 3);
  // the good section covers every judged paragraph
  const good = validateChapter(chapterWith('good')).results[0];
  assert.equal(good.metrics.paragraphs_missing, 0);
  assert.ok(paragraphCoverage(readFileSync(join(FIX, 'good', '01-good.md'), 'utf8'), JSON.parse(readFileSync(join(FIX, 'source.json'), 'utf8')).sections[0])
    .every((p) => p.ratio >= 0.3));
});

test('length follows the source: under 85% may have cut content, over 115% is padding, front matter words override', () => {
  const thin = validateChapter(chapterWith('thin')).results[0];
  assert.match(thin.warnings.find((w) => w.code === 'budget').message, /may have cut content/);
  const src = JSON.parse(readFileSync(join(FIX, 'source.json'), 'utf8')).sections[0];
  const files = { 'app.yaml': readFileSync(join(FIX, 'files', 'app.yaml'), 'utf8') };
  const good = readFileSync(join(FIX, 'good', '01-good.md'), 'utf8');
  const padded = good + '\nIn other words, you get a lot of operational comfort from this: nobody has to babysit the pods at night, '
    + 'restarts happen on their own, and teams can sleep while the controller keeps reconciling what they asked for.\n';
  const p = checkSection(padded, { source: src, files });
  assert.ok(p.metrics.length_ratio > 1.15, `ratio ${p.metrics.length_ratio}`);
  assert.match(p.warnings.find((w) => w.code === 'budget').message, /padding/);
  // quizzes and recaps are the page's own furniture, not padding: they don't count toward the length
  const quizzed = `${good}
:::quiz
? What does a failing readiness probe do to a pod, and what does it leave alone entirely?
+ it stops traffic to the pod but leaves the running container in place
- it restarts the container straight away and also stops all traffic
> Readiness only gates traffic; restarting the container is the job of the liveness probe in the table.
:::

:::recap
- A Deployment keeps three replicas of web alive and replaces any that vanish.
- The readiness probe gates traffic; rolling updates swap pods a few at a time.
:::
`;
  const q = checkSection(quizzed, { source: src, files });
  const plain = checkSection(good, { source: src, files });
  assert.ok(q.metrics.words / plain.metrics.retell_words > 1.15, `words ${q.metrics.words}`);
  assert.equal(q.metrics.retell_words, plain.metrics.retell_words);
  assert.equal(q.warnings.filter((w) => w.code === 'budget').length, 0);
  const pinned = padded.replace('title: Running the web app', 'title: Running the web app\nwords: [50, 200]');
  assert.equal(checkSection(pinned, { source: src, files }).warnings.filter((w) => w.code === 'budget').length, 0);
});

test('a copied run that is mostly names or numbers is a warning, not an error', () => {
  const src = 'It is the default in Oracle 11g, PostgreSQL, SQL Server 2012, MemSQL and many other databases.';
  const out = 'This level ships as the default in Oracle 11g, PostgreSQL, SQL Server 2012, MemSQL and others.';
  const { runs } = copyRuns(out, src);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].names, true);
  assert.equal(copyRuns('a slowdown in one part of the application spreads to the rest of it', 'a slowdown in one part of the application spreads to the rest of it').runs[0].names, false);
});

test('quoting program output the source prints is a warning, copying its prose is an error', () => {
  const source = { id: '4.2', blocks: [
    { kind: 'para', text: 'Rust rejects this with the message cannot borrow `s` as mutable more than once at a time, which protects you from data races.' },
    { kind: 'code', text: 'error[E0499]: cannot borrow `s` as mutable more than once at a time\n --> src/main.rs:5:14' },
    { kind: 'para', text: 'The restriction on mutable references lets Rust prevent data races at compile time in every program.' }] };
  const quote = '---\nid: "4.2"\ntitle: Borrows\n---\nThe compiler answers: cannot borrow `s` as mutable more than once at a time. That stops races.\n';
  const r = checkSection(quote, { source });
  assert.equal(r.errors.filter((e) => e.code === 'copy').length, 0);
  assert.ok(r.warnings.some((w) => w.code === 'copy-output'));
  const prose = '---\nid: "4.2"\ntitle: Borrows\n---\nThe restriction on mutable references lets Rust prevent data races early.\n';
  assert.ok(checkSection(prose, { source }).errors.some((e) => e.code === 'copy'));
});

test('the writer\'s labelled teaching is rendered as not-from-the-book and left out of length and number checks', async () => {
  const { renderSection, newContext } = await import('./render.mjs');
  const source = { id: '7.1', blocks: [{ kind: 'para', text: 'An atomic transaction either applies all of its writes or none of them, so a client can retry it safely after a fault.' }] };
  const page = '---\nid: "7.1"\ntitle: Atomicity\n---\nA transaction applies every one of its writes, or nothing at all; after a fault the client can simply try again.\n\n'
    + ':::callout example\nSay Ann moves 50 from account 1 to account 2 and the database crashes after the first of the 2 writes.\n:::\n\n'
    + ':::callout analogy\nLike a shopping cart you either check out or abandon. It stops working once other people can see the cart.\n:::\n';
  const r = checkSection(page, { source });
  assert.equal(r.metrics.own_callouts, 2);
  assert.ok(r.metrics.retell_words < 25 && r.metrics.own_words > 30, JSON.stringify(r.metrics));
  assert.ok(!r.warnings.some((w) => w.code === 'numbers'), 'toy numbers in an example are not stray');
  const ctx = newContext({ files: {}, file: 's.md', roles: {}, catalog: {} });
  const html = renderSection(page, ctx).html;
  assert.match(html, /class="callout ours"><b>Example \(not from the book\)<\/b>/);
  assert.match(html, /class="callout ours"><b>Analogy<\/b>/);
  assert.deepEqual(ctx.errors, []);
});
