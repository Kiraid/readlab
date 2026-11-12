import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { normalizeFlow, normalizeSequence } from './diagram.mjs';
import { validate } from './schema.mjs';

const flow = (src, aliases) => {
  const errs = [];
  const spec = normalizeFlow(parse(src), { aliases, err: (m) => errs.push(m) });
  return { spec, errs };
};

test('flow shorthand: nodes, edges, groups, journeys and steps', () => {
  const { spec, errs } = flow(`
nodes:
  a: client@0,1 "browser"
  b: gateway@1,1 "proxy" "10.0.0.1"
  c: service@2
groups:
  dc: [b, c]
edges:
  - a > b flow "GET /"
  - b > c
journeys: [a > b > c]
steps:
  - a, a>b: sends
  - b>c
`);
  assert.deepEqual(errs, []);
  assert.deepEqual(spec.nodes[1], { id: 'b', role: 'gateway', col: 1, row: 1, label: 'proxy', sub: '10.0.0.1' });
  assert.deepEqual(spec.nodes[2], { id: 'c', role: 'service', col: 2, row: 0, label: 'c', sub: '' });
  assert.deepEqual(spec.edges[0], { id: 'a>b', from: 'a', to: 'b', style: 'flow', label: 'GET /' });
  assert.deepEqual(spec.steps, [{ show: ['a', 'a>b'], text: 'sends' }, { show: ['b>c'], text: '' }]);
  assert.deepEqual(spec.journeys, [{ chain: ['a', 'b', 'c'], style: 'flow' }]);
});

test('flow errors name the problem', () => {
  const { errs } = flow(`
nodes:
  a: client@0
  b: wizard@0 "this label is far too long for a box in any diagram at all"
edges:
  - a > z
  - a > b sparkly
steps: [nope]
`);
  assert.deepEqual(errs, [
    'node b: unknown role "wizard" (roles: actor, client, gateway, service, worker, datastore, queue, cache, controller, object, secret, external, error, process, resource, note)',
    'node b label: "this label is far too long for a box in any diagram at all" is 58 characters (max 40); shorten it or move detail to the prose',
    'nodes overlap at column 0, row 0',
    'edge 1: unknown node "z"',
    'edge a>b: unknown style "sparkly" (edge, dim, flow, secure, error, ok)',
    'step 1: "nope" is not a node or edge in this diagram',
  ]);
});

test('book role aliases map onto the generic palette', () => {
  const { spec, errs } = flow('nodes:\n  p: pod@0\n', { pod: 'worker' });
  assert.deepEqual(errs, []);
  assert.equal(spec.nodes[0].role, 'worker');
});

test('an edge written as "a > b: x" becomes a YAML map and gets a helpful error', () => {
  const { errs } = flow('nodes:\n  a: client@0\n  b: service@1\nedges:\n  - a > b: oops\n');
  assert.match(errs[0], /write it as a string/);
});

test('a colon inside an edge label is recovered', () => {
  const { spec, errs } = flow('nodes:\n  a: client@0\n  b: service@1\nedges:\n  - a > b flow "Host: shop.example.com"\n');
  assert.deepEqual(errs, []);
  assert.equal(spec.edges[0].label, 'Host: shop.example.com');
});

test('sequence: messages, replies and notes', () => {
  const errs = [];
  const spec = normalizeSequence(parse(`
participants:
  c: client "curl"
  s: service "server"
messages:
  - c > s: GET /
  - s --> c: 200 OK
  - note s: logs the request
steps: auto
`), { err: (m) => errs.push(m) });
  assert.deepEqual(errs, []);
  assert.equal(spec.steps, true);
  assert.deepEqual(spec.messages.map((m) => [m.kind, m.from, m.to, m.style]), [['msg', 'c', 's', 'edge'], ['msg', 's', 'c', 'reply'], ['note', 's', 's', undefined]]);
});

test('schema subset', () => {
  const s = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'integer', minimum: 1 }, b: { enum: ['x', 'y'] }, c: { type: 'array', maxItems: 1, items: { type: 'string' } } } };
  assert.deepEqual(validate({ a: 2, b: 'x', c: ['k'] }, s), []);
  assert.deepEqual(validate({ a: 0, b: 'z', c: ['k', 2], d: 1 }, s), [
    'config.a: must be ≥ 1', 'config.b: must be one of x, y (got "z")', 'config.c: at most 1 item(s)',
    'config.c[1]: expected string, got integer', 'config: unknown field "d" (allowed: a, b, c)']);
});

test('values containing ": " are quoted when the body would not parse otherwise', async () => {
  const { repairYaml } = await import('./render.mjs');
  const body = 'nodes:\n  old: object@1,1 "nonleaf node" "full: N + 1 pointers"\n  p: object@0,1 "parent"\nedges:\n  - old > p flow "Host: x"\nsteps:\n  - old: Found: the key is there.\n  - p\n';
  assert.throws(() => parse(body));
  const fixed = parse(repairYaml(body));
  assert.equal(fixed.nodes.old, 'object@1,1 "nonleaf node" "full: N + 1 pointers"');
  assert.deepEqual(fixed.steps[0], { old: 'Found: the key is there.' });
  const { spec, errs } = flow(repairYaml(body));
  assert.deepEqual(errs, []);
  assert.equal(spec.nodes[0].sub, 'full: N + 1 pointers');
  assert.equal(spec.edges[0].label, 'Host: x');
  // an edge item is one plain scalar; its only ": " sits inside the quoted label
  const quoted = 'nodes:\n  a: object@0,0 "pod"\n  b: controller@1,0 "rs" "controller: true"\nedges:\n  - a > b edge "kind: ReplicaSet, name: kiada"\n';
  assert.throws(() => parse(quoted));
  assert.equal(flow(repairYaml(quoted)).spec.edges[0].label, 'kind: ReplicaSet, name: kiada');
});

test('the YAML repair leaves flow maps alone and only quotes the line that needs it', async () => {
  const { repairYaml } = await import('./render.mjs');
  const body = 'lanes:\n  - { id: sjf, label: SJF }\n  - { id: rr, label: "RR" }\nevents:\n  - { lane: rr, start: 0, end: 1, say: "RR: A runs." }\ncaption: Two policies: RR wins on response\n';
  assert.throws(() => parse(body));
  const fixed = parse(repairYaml(body));
  assert.deepEqual(fixed.lanes, [{ id: 'sjf', label: 'SJF' }, { id: 'rr', label: 'RR' }]);
  assert.equal(fixed.caption, 'Two policies: RR wins on response');
});

test('comma splits inside flow maps are rejoined; one-key maps become strings where the schema wants text', async () => {
  const { rejoinCommaSplits } = await import('./render.mjs');
  const { coerceStrings, validate } = await import('./schema.mjs');
  const nodes = parse('nodes: { waiter: process@0,1 "waiting thread", cpu: resource@1,1 "the only CPU" }');
  assert.deepEqual(rejoinCommaSplits(nodes).nodes, { waiter: 'process@0,1 "waiting thread"', cpu: 'resource@1,1 "the only CPU"' });
  const ev = parse('events:\n  - { lane: a, start: 0, end: 1, say: A runs, which spins until its slice ends. }\n');
  assert.equal(rejoinCommaSplits(ev).events[0].say, 'A runs, which spins until its slice ends.');
  assert.deepEqual(rejoinCommaSplits({ a: 'x', b: null }), { a: 'x', b: null });  // an ordinary empty key stays
  const schema = { type: 'object', properties: { points: { type: 'array', items: { type: 'string' } } } };
  const cfg = coerceStrings(parse('points:\n  - Root page: holds the keys\n  - plain point\n'), schema);
  assert.deepEqual(cfg.points, ['Root page: holds the keys', 'plain point']);
  assert.deepEqual(validate(cfg, schema), []);
});

test('the YAML repair quotes a value that runs on after a quoted phrase', async () => {
  const { repairYaml } = await import('./render.mjs');
  const body = 'points:\n  - Claim: "valuable data" demands care\n';
  assert.throws(() => parse(body));
  assert.deepEqual(parse(repairYaml(body)).points, [{ Claim: '"valuable data" demands care' }]);
});

test('curve-explorer: formulas are checked at build time with the widget\'s own parser, and never run as JS', async () => {
  const { widgetCheck } = await import('./render.mjs');
  const check = widgetCheck('curve-explorer');
  const base = { x: { label: 'slice', min: 1, max: 100 }, y: { label: 'time' }, params: [{ id: 'n', min: 2, max: 10 }] };
  assert.deepEqual(check({ ...base, curves: [{ label: 'avg', expr: '(n - 1) * x / 2 + max(0, log2(x))' }] }), []);
  const bad = (expr) => check({ ...base, curves: [{ label: 'c', expr }] }).join(' ');
  assert.match(bad('(n - 1) * q'), /unknown name "q"/);
  assert.match(bad('alert(1)'), /unknown function "alert"/);
  assert.match(bad('x.constructor'), /unexpected/);
  assert.match(bad('(x + 1'), /expected "\)"/);
  assert.match(check({ ...base, curves: [{ label: 'c' }] }).join(), /formula \(expr\) or the book's data/);
  assert.match(check({ ...base, curves: [{ label: 'c', points: [[1, 2], [3]] }] }).join(), /points\[1\]: write \[x, y\]/);
});
