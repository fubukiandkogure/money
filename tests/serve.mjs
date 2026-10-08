// GitHub Pages と同じように、app/ を /money/ の下で配信するテスト用サーバー（依存なし）
//   node tests/serve.mjs [port]  →  http://localhost:8080/money/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const BASE = '/money/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function startServer(port = 8080) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/subseat/' || url.pathname === '/subseat/index.html') {
      // 同じドメインにある別アプリ（D10 の確認用の見本）
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>other app</title><p>other app');
      return;
    }
    if (url.pathname === '/money') {
      res.writeHead(301, { location: BASE });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not file');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('404');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 8080);
  await startServer(port);
  console.log(`http://localhost:${port}${BASE}`);
}
