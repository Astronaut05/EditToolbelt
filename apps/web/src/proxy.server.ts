/**
 * The server build's proxy (Next's middleware), in front of every request:
 * - `www.` goes to the site's own host (SITE_URL).
 * - Cloudflare Access: in production every request must carry a valid Access
 *   token (src/server/access.ts), except the health checks and the payment
 *   webhooks. Without the Access settings, production answers 503.
 * - The headers the static site gets from `_headers` (src/lib/headers.ts):
 *   the security headers everywhere, caching for hashed assets, COOP/COEP on
 *   the routes that need them.
 * - The Content Security Policy on pages. Pages rendered per request get a
 *   fresh nonce (Next reads it from the request's CSP header and puts it on
 *   its scripts) plus the theme script's hash; prerendered pages get the
 *   'unsafe-inline' fallback (src/lib/csp.ts). Never cached: /account,
 *   /sign-in, /admin, /connect, /credits. /credits/buy alone may load
 *   Paddle.js, and only while Paddle is set up and payments are on.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { themeScript } from '@etb/ui/theme';

import { buildCsp, originOf } from './lib/csp';
import { headersForPath } from './lib/headers';
import { PADDLE_CSP } from './lib/paddle-js';
import { accessConfig, accessExempt, teamKeys, verifyAccessToken } from './server/access';

/** Rendered per request, for one signed-in person: nonce CSP, no caching. */
const PERSONAL = ['/account', '/sign-in', '/admin', '/connect', '/credits'];

/** The one page that may load Paddle.js, for its overlay checkout (docs/11 → Web app). */
const CHECKOUT_PAGE = '/credits/buy';

/**
 * Whether Paddle can take money: payments on and Paddle's client token set.
 * Only then does /credits/buy's CSP let Paddle.js in. The admin switch lives
 * in the database, which the proxy doesn't reach; the page itself answers 404
 * unless a provider is on, and loads Paddle.js only for a Paddle checkout.
 */
const paddleOn =
  /^(true|1|yes|on)$/i.test(process.env.PAYMENTS_ENABLED?.trim() ?? '') &&
  Boolean(process.env.PADDLE_CLIENT_TOKEN?.trim());

/** Not pages: no CSP of their own (API answers, hashed assets, models, icons, the service worker). */
const NOT_PAGES = ['/_next/', '/api/', '/models/', '/icons/'];
const NOT_PAGE_FILES = new Set(['/favicon.ico', '/sw.js']);

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

const access = accessConfig(process.env);
const keys = access ? teamKeys(access) : null;
const production = process.env.APP_ENV === 'production';

/** null when the request may go on; otherwise the answer that stops it. */
async function accessDenied(request: NextRequest): Promise<NextResponse | null> {
  if (accessExempt(request.nextUrl.pathname)) return null;
  if (!access || !keys) {
    return production
      ? new NextResponse('Cloudflare Access is not configured.', { status: 503 })
      : null;
  }
  const token =
    request.headers.get('cf-access-jwt-assertion') ??
    request.cookies.get('CF_Authorization')?.value;
  if (!token) return new NextResponse('Forbidden', { status: 403 });
  const result = await verifyAccessToken(token, access, keys);
  return result.ok ? null : new NextResponse('Forbidden', { status: 403 });
}

/** `www.<site>` → `<site>`, keeping the path and query. */
function wwwRedirect(request: NextRequest): NextResponse | null {
  const site = process.env.SITE_URL;
  const host = request.headers.get('host');
  if (!site || !host) return null;
  const target = new URL(site);
  if (host.toLowerCase() !== `www.${target.host}`) return null;
  target.pathname = request.nextUrl.pathname;
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 308);
}

export default async function proxy(request: NextRequest) {
  const redirect = wwwRedirect(request);
  if (redirect) return redirect;
  const denied = await accessDenied(request);
  if (denied) return denied;

  const { pathname } = request.nextUrl;
  const pathHeaders = headersForPath(pathname);
  if (NOT_PAGES.some((prefix) => pathname.startsWith(prefix)) || NOT_PAGE_FILES.has(pathname)) {
    const response = NextResponse.next();
    for (const [name, value] of pathHeaders) response.headers.set(name, value);
    return response;
  }

  if ((pathname === '/admin' || pathname.startsWith('/admin/')) && !adminAllowed(request)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const personal = PERSONAL.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const nonce = personal ? btoa(crypto.randomUUID()) : undefined;
  const paddle = pathname === CHECKOUT_PAGE && paddleOn;
  const csp = buildCsp({
    ...(nonce ? { nonce, hashes: [await themeScriptHash()] } : { inline: true, wasm: true }),
    ...(paddle && {
      scripts: PADDLE_CSP.scripts,
      styles: PADDLE_CSP.styles,
      frames: PADDLE_CSP.frames,
    }),
    dev: process.env.NODE_ENV === 'development',
    connect: paddle ? [...connect, ...PADDLE_CSP.connect] : connect,
    header: true,
  });
  const forwarded = new Headers(request.headers);
  forwarded.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of pathHeaders) response.headers.set(name, value);
  if (personal) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  // Every request: Access covers assets and the API too.
  matcher: ['/:path*'],
};
