/**
 * Serves the static export (apps/web/out) the way Cloudflare Pages will, so
 * milestones are checked against the real production build on this machine
 * (docs/12-milestones.md). No dependencies: Node's http/https only.
 *
 *   pnpm preview                        build, then http://localhost:4173
 *   pnpm preview --lan --https          phones on Wi-Fi, with mkcert certificates
 *
 * Options: --port <n> (default 4173), --lan (listen on all interfaces instead of
 * 127.0.0.1), --https (TLS with --cert/--key, default certs/local.pem and
 * certs/local-key.pem at the repo root; see README → Testing on phones).
 *
 * Applies the build's `_headers` file the way Cloudflare Pages does (path
 * patterns with `*` splats and `:placeholders`, every matching rule applies,
 * repeated headers are joined with ", ", `! Name` detaches a header), so the
 * CSP and COOP/COEP proofs run locally.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const WEB_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(WEB_DIR, '..', '..');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

export function contentType(file: string): string {
  return MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Maps a request path to a file under `root` like Cloudflare Pages:
 * `/` → index.html, `/about` → about.html or about/index.html, exact files as-is.
 * Returns null for anything outside `root` or not found.
 */
export function resolveFile(
  root: string,
  urlPath: string,
  isFile: (path: string) => boolean,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]?.split('#')[0] ?? '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const base = resolve(root);
  const target = resolve(base, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (target !== base && !target.startsWith(base + sep)) return null;

  const candidates = decoded.endsWith('/')
    ? [join(target, 'index.html')]
    : [target, `${target}.html`, join(target, 'index.html')];
  return candidates.find((candidate) => isFile(candidate)) ?? null;
}

export interface HeaderRule {
  pattern: RegExp;
  set: [string, string][];
  detach: string[];
}

/** Parses a Cloudflare Pages `_headers` file. */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      const source = raw
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/:[A-Za-z]\w*/g, '[^/]+');
      current = { pattern: new RegExp(`^${source}$`), set: [], detach: [] };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    if (line.startsWith('!')) {
      current.detach.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0) current.set.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Headers for one request path: all matching rules, repeated names joined. */
export function headersFor(urlPath: string, rules: HeaderRule[]): Record<string, string> {
  const path = urlPath.split('?')[0]?.split('#')[0] ?? '/';
  const out = new Map<string, [string, string]>();
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue;
    for (const name of rule.detach) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      const existing = out.get(key);
      out.set(key, existing ? [existing[0], `${existing[1]}, ${value}`] : [name, value]);
    }
  }
  return Object.fromEntries(out.values());
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function send(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  file: string,
  extra: Record<string, string>,
): void {
  const body = readFileSync(file);
  res.writeHead(status, {
    'Content-Type': contentType(file),
    'Content-Length': body.length,
    'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=0, must-revalidate',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function main(): void {
  const { values } = parseArgs({
    // `pnpm preview -- --lan` passes the `--` through; ignore it.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      port: { type: 'string', default: '4173' },
      dir: { type: 'string', default: join(WEB_DIR, 'out') },
      lan: { type: 'boolean', default: false },
      https: { type: 'boolean', default: false },
      cert: { type: 'string', default: join(REPO_ROOT, 'certs', 'local.pem') },
      key: { type: 'string', default: join(REPO_ROOT, 'certs', 'local-key.pem') },
    },
  });
  const root = resolve(values.dir);
  if (!existsSync(join(root, 'index.html'))) {
    console.error(
      `No build in ${root}. Run \`pnpm preview\` from the repo root (it builds first).`,
    );
    process.exit(1);
  }

  const headersFile = join(root, '_headers');
  const rules = existsSync(headersFile) ? parseHeaders(readFileSync(headersFile, 'utf8')) : [];
  if (rules.length === 0)
    console.warn('No _headers file in the build: serving without security headers.');

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = req.url ?? '/';
    const extra = headersFor(url, rules);
    const file = resolveFile(root, url, isFile);
    // Like Pages, the _headers file itself is never served.
    if (file && !file.endsWith(`${sep}_headers`)) {
      send(res, req, 200, file, extra);
      return;
    }
    const notFound = join(root, '404.html');
    if (isFile(notFound)) send(res, req, 404, notFound, extra);
    else res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  };

  let server;
  if (values.https) {
    if (!existsSync(values.cert) || !existsSync(values.key)) {
      console.error(
        `--https needs a certificate and key (looked for ${values.cert} and ${values.key}).\n` +
          'Create them with mkcert as described in README → Testing on phones.',
      );
      process.exit(1);
    }
    server = createHttpsServer(
      { cert: readFileSync(values.cert), key: readFileSync(values.key) },
      handler,
    );
  } else {
    server = createHttpServer(handler);
  }

  const host = values.lan ? '0.0.0.0' : '127.0.0.1';
  const port = Number(values.port);
  const scheme = values.https ? 'https' : 'http';
  server.listen(port, host, () => {
    console.log(`Serving ${root}`);
    console.log(`  ${scheme}://localhost:${String(port)}`);
    if (values.lan) {
      const addresses = Object.values(networkInterfaces())
        .flat()
        .filter((net) => net && net.family === 'IPv4' && !net.internal)
        .map((net) => net?.address ?? '');
      for (const address of addresses)
        console.log(`  ${scheme}://${address}:${String(port)}  (LAN)`);
      if (!values.https) {
        console.log(
          '  Note: plain http on a LAN address is not a secure context on phones; use --https.',
        );
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
