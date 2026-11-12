/**
 * The server build's proxy (Next's middleware), in front of every request:
 * - `www.` goes to the site's own host (SITE_URL).
 * - The origin lock, when ORIGIN_AUTH_SECRET is set: a request that didn't
 *   come through Cloudflare (no secret header) is refused, except Railway's
 *   health checks (src/server/access.ts).
 * - Cloudflare Access (src/server/access.ts). The site is public: only
 *   `/admin` must carry a valid Access token, and only while an Access
 *   application is set up for it; the admin's own sign-in and two-factor
 *   check stand behind that either way. With SITE_ACCESS=private every
 *   request must carry one, except the health checks and the payment
 *   webhooks, and production answers 503 until Access is set up.
 * - The headers the static site gets from `_headers` (src/lib/headers.ts):
 *   the security headers everywhere, caching for hashed assets, COOP/COEP on
 *   the routes that need them.
 * - The Content Security Policy on pages. Pages rendered per request get a
 *   fresh nonce (Next reads it from the request's CSP header and puts it on
 *   its scripts) plus the theme script's hash; prerendered pages get the
 *   'unsafe-inline' fallback and 'wasm-unsafe-eval' (src/lib/csp.ts;
 *   docs/decisions/2026-10-02-server-build-csp.md). Never cached: /account,
 *   /sign-in, /admin, /connect, /credits (src/lib/personal.ts). /credits/buy
 *   alone may load Paddle.js, and only while Paddle is set up and payments are on.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { BROWSER_API_ORIGINS } from '@etb/core/third-party';
import { themeScript } from '@etb/ui/theme';

import { buildCsp, originOf, storageOrigin } from './lib/csp';
import { headersForPath } from './lib/headers';
import { PADDLE_CSP } from './lib/paddle-js';
import { isPersonalPath } from './lib/personal';
import {
  accessConfig,
  accessGated,
  healthCheckPath,
  ORIGIN_AUTH_HEADER,
  originAllowed,
  originSecret,
  siteAccess,
  teamKeys,
  verifyAccessToken,
} from './server/access';

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
  storageOrigin(),
  // Third-party APIs a tool calls from the browser (T09's Gemini): on every page,
  // since a client-side navigation keeps the CSP of the page it started on.
  ...BROWSER_API_ORIGINS,
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

const mode = siteAccess(process.env);
const access = accessConfig(process.env);
const keys = access ? teamKeys(access) : null;
const production = process.env.APP_ENV === 'production';
const origin = originSecret(process.env);

/** null when the request may go on; otherwise the answer that stops it. */
async function accessDenied(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (
    origin &&
    !healthCheckPath(pathname) &&
    !originAllowed(request.headers.get(ORIGIN_AUTH_HEADER), origin)
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  if (!accessGated(pathname, mode)) return null;
  if (!access || !keys) {
    // A private site must never open because a setting is missing. A public
    // site's /admin still has its own sign-in and two-factor check.
    return mode === 'private' && production
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
  const personal = isPersonalPath(pathname);
  const nonce = personal ? btoa(crypto.randomUUID()) : undefined;
  const paddle = pathname === CHECKOUT_PAGE && paddleOn;
  // Every public page may compile WebAssembly, not only the tools that do: a
  // client-side navigation keeps the CSP of the page it started on, and the
  // MP3 and FLAC encoders compile theirs in blob workers, which inherit it.
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
