/**
 * The server build's proxy (Next's middleware): the security headers the
 * static site gets from `_headers`, and the Content Security Policy. Pages
 * rendered per request get a fresh nonce (Next reads it from the request's
 * CSP header and puts it on its scripts) plus the theme script's hash;
 * prerendered pages get the
 * 'unsafe-inline' fallback (src/lib/csp.ts). Never cached: /account, /sign-in, /admin.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { themeScript } from '@etb/ui/theme';

import { buildCsp, originOf } from './lib/csp';
import { headerRules } from './lib/headers';

/** Rendered per request, for one signed-in person: nonce CSP, no caching. */
const PERSONAL = ['/account', '/sign-in', '/admin'];

/** Models, analytics, and storage: browsers upload parts to it and download results from it. */
const connect = [
  originOf(process.env.MODELS_BASE_URL),
  originOf(process.env.ANALYTICS_URL),
  originOf(process.env.STORAGE_ORIGIN),
].filter((origin): origin is string => origin !== null);

/** The root layout's one inline script of ours (the saved theme, before paint), allowed by hash. */
let themeHash: Promise<string> | undefined;

function themeScriptHash(): Promise<string> {
  themeHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(themeScript))
    .then((digest) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`);
  return themeHash;
}

const siteHeaders = (headerRules()[0]?.headers ?? []).filter(
  ([name]) => name !== 'Content-Security-Policy',
);

/** The client's IP, as Cloudflare or a reverse proxy passes it; only compared, never kept. */
function clientIp(request: NextRequest): string | null {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}

/** docs/07: an optional IP allowlist in front of /admin. */
function adminAllowed(request: NextRequest): boolean {
  const list = process.env.ADMIN_IP_ALLOWLIST;
  if (!list) return true;
  const ip = clientIp(request);
  return ip !== null && list.split(',').some((allowed) => allowed.trim() === ip);
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if ((pathname === '/admin' || pathname.startsWith('/admin/')) && !adminAllowed(request)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const personal = PERSONAL.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const nonce = personal ? btoa(crypto.randomUUID()) : undefined;
  const csp = buildCsp({
    ...(nonce ? { nonce, hashes: [await themeScriptHash()] } : { inline: true, wasm: true }),
    dev: process.env.NODE_ENV === 'development',
    connect,
    header: true,
  });
  const forwarded = new Headers(request.headers);
  forwarded.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of siteHeaders) response.headers.set(name, value);
  if (personal) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/|models/|icons/|favicon.ico|sw.js).*)'],
};
