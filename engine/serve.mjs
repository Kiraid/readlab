// Tiny static server for the engine.
//   node engine/serve.mjs [--port 8412] [--content <dir>]
// Files are looked up in the content dir first (a built chapter, or a reference folder),
// then in engine/. That keeps book content out of the engine folder.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const port = Number(opt('--port', process.env.PORT || 8412));
const content = opt('--content', null);
const roots = [...(content ? [resolve(content)] : []), engineRoot].map((r) => normalize(r + '/'));

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

async function find(p) {
  for (const root of roots) {
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) continue; // path traversal
    try { return { file, body: await readFile(file) }; } catch { /* try next root */ }
  }
  return null;
}

http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const hit = await find(p);
  if (!hit) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(hit.file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(hit.body);
}).listen(port, '127.0.0.1', () => console.log(`engine → http://localhost:${port}/` + (content ? `  (content: ${content})` : '')));
