// Local dev server for BlockGraph.
// app/index.html is written the way claude.ai Artifacts expect (no <html>/<head>
// skeleton), so this server wraps it in one before serving.
//
//   node tools/serve.mjs [port]
//
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const port = Number(process.argv[2]) || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const SKELETON_HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>';

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root)) throw new Error('outside root');
      if (url.pathname === '/' || url.pathname.endsWith('/')) file = path.join(file, 'index.html');
      let body = await fs.readFile(file);
      const ext = path.extname(file);
      if (ext === '.html') body = SKELETON_HEAD + body.toString('utf8') + '</body></html>';
      res.writeHead(200, { 'content-type': (types[ext] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  })
  .listen(port, () => console.log(`BlockGraph running at http://localhost:${port}`));
