/**
 * Serves dist/ for the panel's browser tests and for working on its look:
 * the same page Premiere loads, with the browser host standing in for
 * Premiere. `pnpm --filter @etb/panel serve` (port 4176, or --port <n>).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const flag = process.argv.indexOf('--port');
const PORT = flag > 0 ? Number(process.argv[flag + 1]) : 4176;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const file = resolve(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response
    .writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    .end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Panel on http://localhost:${String(PORT)}`);
});
