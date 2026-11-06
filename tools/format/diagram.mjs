// Diagram DSL: validate and normalise at build time; engine/js/diagram.js does layout at runtime.
//
// flow:
//   nodes:                          id: role@col,row "label" "sub"   (row, label and sub optional)
//     client: client@0,1 "Browser"
//     proxy:  gateway@1,1 "ingress proxy" "11.22.33.44"
//   groups:                         name: [ids]  or  name: {nodes: [ids], label: "..."}
//     cluster: [proxy, quote]
//   edges:                          from > to style "label"   (style: edge dim flow secure error ok)
//     - client > proxy flow "GET /quote"
//   journeys:                       animated packets that travel a whole chain of edges
//     - client > proxy > quote
//   steps:                          "ids"  or  {"ids": "narration"}; ids are nodes and edges (a>b)
//     - client, client>proxy: The browser sends the request.
//   caption: "..."
//
// sequence:
//   participants:                   id: role "label" "sub"
//     client: client "curl"
//   messages:                       {"a > b": label} solid, {"a --> b": label} reply (dashed),
//     - client > proxy: ClientHello  {"note a": text} or {"note a,b": text}; object form adds say/style
//   steps: auto                     each message becomes a step (narration = say, else label)
//   caption: "..."
export const ROLES = ['actor', 'client', 'gateway', 'service', 'worker', 'datastore', 'queue', 'cache', 'controller',
  'object', 'secret', 'external', 'error', 'process', 'resource', 'note'];
export const EDGE_STYLES = ['edge', 'dim', 'flow', 'secure', 'error', 'ok'];
const LIMITS = { label: 40, sub: 36, edge: 44, message: 60, col: 12, row: 12 };

const NODE_RE = /^([a-z][\w-]*)\s*(?:@\s*(\d+)\s*(?:,\s*(\d+))?)?\s*(?:"([^"]*)")?\s*(?:"([^"]*)")?\s*$/i;
const EDGE_RE = /^([\w-]+)\s*>\s*([\w-]+)\s*([a-z]+)?\s*(?:"([^"]*)")?\s*$/;

function roleOf(role, aliases, err, where) {
  const r = aliases[role] || role;
  if (!ROLES.includes(r)) err(`${where}: unknown role "${role}" (roles: ${ROLES.join(', ')}${Object.keys(aliases).length ? `; book aliases: ${Object.keys(aliases).join(', ')}` : ''})`);
  return r;
}

function checkLen(text, max, err, where) {
  if (text && text.length > max) err(`${where}: "${text}" is ${text.length} characters (max ${max}); shorten it or move detail to the prose`);
}

function stepList(raw, known, err) {
  if (raw === undefined || raw === null || raw === false) return [];
  if (!Array.isArray(raw)) { err('steps must be a list'); return []; }
  return raw.map((s, i) => {
    let ids, text = '';
    if (typeof s === 'string') ids = s;
    else if (Array.isArray(s)) ids = s.join(',');
    else if (s && typeof s === 'object' && 'show' in s) { ids = [].concat(s.show).join(','); text = s.text || ''; }
    else if (s && typeof s === 'object' && Object.keys(s).length === 1) { ids = Object.keys(s)[0]; text = String(Object.values(s)[0] ?? ''); }
    else { err(`step ${i + 1}: write "ids" or {"ids": "narration"}`); return { show: [], text: '' }; }
    const show = ids.split(',').map((x) => x.trim().replace(/\s*>\s*/g, '>')).filter(Boolean);
    for (const id of show) if (!known.has(id)) err(`step ${i + 1}: "${id}" is not a node or edge in this diagram`);
    return { show, text };
  });
}

export function normalizeFlow(spec, { aliases = {}, err }) {
  const nodes = [];
  const ids = new Set();
  const rawNodes = spec.nodes;
  if (!rawNodes || typeof rawNodes !== 'object' || Array.isArray(rawNodes)) err('flow diagram needs a "nodes:" map (id: role@col,row "label")');
  for (const [id, v] of Object.entries(rawNodes || {})) {
    let n;
    if (typeof v === 'string') {
      const m = NODE_RE.exec(v.trim());
      if (!m) { err(`node ${id}: can't read "${v}" (expected role@col,row "label" "sub")`); continue; }
      n = { id, role: m[1], col: m[2] === undefined ? null : +m[2], row: m[3] === undefined ? 0 : +m[3], label: m[4] ?? id, sub: m[5] ?? '' };
    } else if (v && typeof v === 'object') {
      n = { id, role: v.role, col: v.col ?? null, row: v.row ?? 0, label: v.label ?? id, sub: v.sub ?? '' };
    } else { err(`node ${id}: empty`); continue; }
    n.role = roleOf(n.role || 'object', aliases, err, `node ${id}`);
    checkLen(n.label, LIMITS.label, err, `node ${id} label`);
    checkLen(n.sub, LIMITS.sub, err, `node ${id} sub`);
    if (n.col !== null && n.col > LIMITS.col) err(`node ${id}: column ${n.col} is too far right (max ${LIMITS.col})`);
    if (n.row > LIMITS.row) err(`node ${id}: row ${n.row} is too low (max ${LIMITS.row})`);
    nodes.push(n);
    ids.add(id);
  }
  nodes.forEach((n, i) => { if (n.col === null) n.col = i; }); // no position: left to right

  const seen = new Set();
  for (const n of nodes) {
    const k = `${n.col},${n.row}`;
    if (seen.has(k)) err(`nodes overlap at column ${n.col}, row ${n.row}`);
    seen.add(k);
  }

  const edges = [];
  for (let [i, e] of (spec.edges || []).entries()) {
    let from, to, style = 'edge', label = '';
    // `- a > b flow "Host: x"`: the colon inside the label makes YAML read a one-key map. Put it back.
    if (e && typeof e === 'object' && !Array.isArray(e) && !('from' in e) && Object.keys(e).length === 1) {
      const [k, v] = Object.entries(e)[0];
      const joined = `${k}: ${v ?? ''}`;
      if (EDGE_RE.test(joined.trim())) e = joined;
    }
    if (typeof e === 'string') {
      const m = EDGE_RE.exec(e.trim());
      if (!m) { err(`edge ${i + 1}: can't read "${e}" (expected: from > to style "label")`); continue; }
      [, from, to] = m; style = m[3] || 'edge'; label = m[4] || '';
    } else if (e && typeof e === 'object') {
      if ('from' in e) ({ from, to, style = 'edge', label = '' } = e);
      else { err(`edge ${i + 1}: write it as a string, e.g. "a > b flow \\"label\\"" (a "key: value" pair turns it into a map)`); continue; }
    }
    if (!ids.has(from)) err(`edge ${i + 1}: unknown node "${from}"`);
    if (!ids.has(to)) err(`edge ${i + 1}: unknown node "${to}"`);
    if (!EDGE_STYLES.includes(style)) err(`edge ${from}>${to}: unknown style "${style}" (${EDGE_STYLES.join(', ')})`);
    checkLen(label, LIMITS.edge, err, `edge ${from}>${to} label`);
    let id = `${from}>${to}`;
    if (edges.some((x) => x.id === id)) id += `#${edges.filter((x) => x.id.startsWith(id)).length + 1}`;
    edges.push({ id, from, to, style, label });
  }
  const edgeIds = new Set(edges.map((e) => e.id));

  const groups = [];
  for (const [name, g] of Object.entries(spec.groups || {})) {
    const members = Array.isArray(g) ? g : g && g.nodes;
    if (!Array.isArray(members) || !members.length) { err(`group ${name}: needs a list of node ids`); continue; }
    for (const m of members) if (!ids.has(m)) err(`group ${name}: unknown node "${m}"`);
    groups.push({ id: name, label: (g && g.label) || name, nodes: members });
  }

  const journeys = [];
  for (const [i, j] of (spec.journeys || []).entries()) {
    const chain = String(j).split('>').map((s) => s.trim()).filter(Boolean);
    const style = /\b(secure|error|ok)\b/.exec(chain[chain.length - 1]);
    if (style) chain[chain.length - 1] = chain[chain.length - 1].replace(style[0], '').trim();
    for (let k = 0; k + 1 < chain.length; k++) {
      if (!edgeIds.has(`${chain[k]}>${chain[k + 1]}`)) err(`journey ${i + 1}: there is no edge ${chain[k]} > ${chain[k + 1]}`);
    }
    journeys.push({ chain, style: style ? style[1] : 'flow' });
  }

  const known = new Set([...ids, ...edgeIds, ...groups.map((g) => g.id)]);
  const steps = stepList(spec.steps, known, err);
  return { type: 'flow', nodes, edges, groups, journeys, steps, packets: spec.packets !== false, caption: spec.caption || '' };
}

export function normalizeSequence(spec, { aliases = {}, err }) {
  const participants = [];
  for (const [id, v] of Object.entries(spec.participants || {})) {
    const m = /^([a-z][\w-]*)\s*(?:"([^"]*)")?\s*(?:"([^"]*)")?\s*$/i.exec(String(v || 'actor').trim());
    if (!m) { err(`participant ${id}: can't read "${v}" (expected role "label" "sub")`); continue; }
    const p = { id, role: roleOf(m[1], aliases, err, `participant ${id}`), label: m[2] ?? id, sub: m[3] ?? '' };
    checkLen(p.label, LIMITS.label, err, `participant ${id} label`);
    participants.push(p);
  }
  if (participants.length < 2) err('sequence diagram needs at least two participants');
  const ids = new Set(participants.map((p) => p.id));
  const messages = [];
  for (const [i, m] of (spec.messages || []).entries()) {
    if (!m || typeof m !== 'object') { err(`message ${i + 1}: write {"a > b": label}`); continue; }
    let key, label, extra = {};
    if ('from' in m || 'note' in m) {
      key = m.note ? `note ${m.note}` : `${m.from} ${m.reply ? '-->' : '>'} ${m.to}`;
      label = m.label ?? m.text ?? '';
      extra = { say: m.say || '', style: m.style || '' };
    } else {
      [key] = Object.keys(m);
      label = String(Object.values(m)[0] ?? '');
    }
    const note = /^note\s+([\w-]+)(?:\s*,\s*([\w-]+))?$/.exec(key.trim());
    if (note) {
      for (const p of [note[1], note[2]].filter(Boolean)) if (!ids.has(p)) err(`message ${i + 1}: unknown participant "${p}"`);
      messages.push({ kind: 'note', from: note[1], to: note[2] || note[1], label, say: extra.say || '' });
      continue;
    }
    const mm = /^([\w-]+)\s*(-->|>)\s*([\w-]+)$/.exec(key.trim());
    if (!mm) { err(`message ${i + 1}: can't read "${key}" (expected "a > b", "a --> b" or "note a")`); continue; }
    for (const p of [mm[1], mm[3]]) if (!ids.has(p)) err(`message ${i + 1}: unknown participant "${p}"`);
    const style = extra.style || (mm[2] === '-->' ? 'reply' : 'edge');
    if (![...EDGE_STYLES, 'reply'].includes(style)) err(`message ${i + 1}: unknown style "${style}"`);
    checkLen(label, LIMITS.message, err, `message ${i + 1} label`);
    messages.push({ kind: 'msg', from: mm[1], to: mm[3], label, style, say: extra.say || '' });
  }
  const steps = spec.steps === 'auto' || spec.steps === true;
  return { type: 'sequence', participants, messages, steps, caption: spec.caption || '' };
}
