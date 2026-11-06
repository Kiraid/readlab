// Minimal YAML for the subset used in files.js: block maps, block sequences,
// plain/quoted scalars, comments and '---' document separators.
(function () {
  function stripComment(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
    }
    return line.replace(/\s+$/, '');
  }

  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s[0] === '"' && s.endsWith('"')) { try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
    if (s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s === '[]') return [];
    if (s === '{}') return {};
    return s;
  }

  function parseDoc(src) {
    const lines = [];
    for (const raw of src.split(/\r?\n/)) {
      const s = stripComment(raw);
      if (!s.trim()) continue;
      lines.push({ indent: s.match(/^ */)[0].length, text: s.trim() });
    }
    if (!lines.length) return null;
    let i = 0;
    const isItem = (l) => l.text === '-' || l.text.startsWith('- ');

    function block() {
      const l = lines[i];
      return isItem(l) ? seq(l.indent) : map(l.indent);
    }
    function map(indent) {
      const obj = {};
      while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
        const m = lines[i].text.match(/^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/);
        if (!m) throw new Error('cannot parse line: ' + lines[i].text);
        i++;
        const key = scalar(m[1]);
        if (m[2] !== undefined && m[2] !== '') obj[key] = scalar(m[2]);
        else if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isItem(lines[i])))) obj[key] = block();
        else obj[key] = null;
      }
      return obj;
    }
    function seq(indent) {
      const arr = [];
      while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
        const after = lines[i].text.slice(2);
        if (/^[^"'\s-][^:]*:(\s|$)/.test(after)) {
          lines[i] = { indent: indent + 2, text: after };
          arr.push(map(indent + 2));
        } else { i++; arr.push(scalar(after)); }
      }
      return arr;
    }
    return block();
  }

  function parseAll(src) {
    return src.split(/^---\s*$/m).map(parseDoc).filter(Boolean);
  }

  const RESERVED = /^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?)$/i;
  function fmt(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v !== 'string') return String(v);
    if (v === '') return '""';
    if (RESERVED.test(v) || /^[*&!%@`{\[|>?,'"#-]/.test(v) || /: |\s#/.test(v) || /^\s|\s$/.test(v)) {
      return v.includes('"') ? "'" + v.replace(/'/g, "''") + "'" : JSON.stringify(v);
    }
    return v;
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  function stringify(v, ind = 0) {
    const pad = ' '.repeat(ind);
    if (Array.isArray(v)) {
      return v.map((item) => {
        if (isObj(item) && Object.keys(item).length) return pad + '- ' + stringify(item, ind + 2).slice(ind + 2);
        return pad + '- ' + fmt(item);
      }).join('\n');
    }
    if (isObj(v)) {
      return Object.entries(v).map(([k, val]) => {
        if (Array.isArray(val)) return val.length ? `${pad}${k}:\n${stringify(val, ind)}` : `${pad}${k}: []`;
        if (isObj(val)) return Object.keys(val).length ? `${pad}${k}:\n${stringify(val, ind + 2)}` : `${pad}${k}: {}`;
        return `${pad}${k}: ${fmt(val)}`;
      }).join('\n');
    }
    return pad + fmt(v);
  }

  window.YAML = { parseAll, parse: parseDoc, stringify };
})();
