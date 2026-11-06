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
import { copyRuns, strayNumbers, words } from './checks.mjs';
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
  writeFileSync(join(dir, 'case.yaml'), 'id: fixture\ntitle: Running the web app\nshell: basic\nbrief: "Teach it. Budget: 60-200 words of prose."\nexpect: { visual_min: 1, quiz_min: 1, widget_any: [timeline] }\n');
  const good = scoreOutput(dir, join(FIX, 'good', '01-good.md'));
  assert.equal(good.pass, true);
  assert.deepEqual(good.must, { builds: true, no_copy: true, listings_shown: true, files_exist: true });
  assert.equal(good.should.invited_widget, 0);
  assert.ok(good.score >= 60 && good.score < 100, `score ${good.score}`);
  const bad = scoreOutput(dir, join(FIX, 'bad', '01-bad.md'));
  assert.equal(bad.pass, false);
  assert.equal(bad.must.no_copy, false);
  assert.equal(bad.must.listings_shown, false);
});
