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
