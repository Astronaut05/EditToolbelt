/**
 * Cloudflare Access and the site (docs/01-architecture.md → Hosting).
 *
 * The site is public (docs/decisions/2026-11-12-go-public.md): every page and
 * the API answer anyone. Access stays in front of `/admin` only, as a second
 * lock before the admin's own sign-in and two-factor check. With
 * `SITE_ACCESS=private` the whole site sits behind Access instead, as it did
 * until Go public (a staging copy, or taking the site private again).
 *
 * Where Access covers a path it lets only its allowed people (and service
 * tokens) through, and adds a signed token to every request it passes on:
 * `Cf-Access-Jwt-Assertion`. The web service checks that token itself on the
 * gated paths, so a request sent straight to Railway's edge can't get around
 * Access.
 *
 * The token is an RS256 JWT signed with the team's keys
 * (`<team domain>/cdn-cgi/access/certs`), for this application's audience tag.
 * Keys are cached for an hour, and fetched again (at most once a minute) when
 * a token names a key we don't have, which is how Cloudflare rotates them.
 */

export interface AccessConfig {
  /** `https://<team>.cloudflareaccess.com`: the issuer, and where the keys are. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  audience: string;
}

export type AccessResult = { ok: true; subject: string } | { ok: false; reason: string };

/** Paths that skip the check: Railway's health check, and payment webhooks (signed by their sender). */
const OPEN_PATHS = ['/healthz', '/readyz'];
const OPEN_PREFIXES = ['/api/webhooks/'];

export function accessExempt(pathname: string): boolean {
  return OPEN_PATHS.includes(pathname) || OPEN_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Railway's own health check: it reaches the service on the private network, not through Cloudflare. */
export function healthCheckPath(pathname: string): boolean {
  return OPEN_PATHS.includes(pathname);
}

/** `public`: only `/admin` is behind Access. `private`: every path is. */
export type SiteAccess = 'public' | 'private';

/** SITE_ACCESS, public unless it says private. */
export function siteAccess(env: Record<string, string | undefined>): SiteAccess {
  return env.SITE_ACCESS?.trim().toLowerCase() === 'private' ? 'private' : 'public';
}

/**
 * The path as the router will read it, for comparing with `/admin`: decoded
 * once, slashes collapsed, lower case. `/%61dmin` and `//admin/` must not
 * slip past a check that `/admin` would meet; gating a path too many is
 * harmless (its page doesn't exist).
 */
function comparable(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Not valid percent-encoding: compare it as sent.
  }
  return path.replace(/[\\/]+/g, '/').toLowerCase();
}

/** Whether a request for this path must carry a valid Access token. */
export function accessGated(pathname: string, mode: SiteAccess): boolean {
  if (accessExempt(pathname)) return false;
  if (mode === 'private') return true;
  const path = comparable(pathname);
  return path === '/admin' || path.startsWith('/admin/');
}

/**
 * The config from env, or null when Access isn't set up (local, test, or a
 * public site with no Access application on `/admin`). The team domain may be
 * a bare host, as Cloudflare's dashboard shows it. One that isn't a URL at
 * all reads as not set up: the caller decides what that means, and nothing
 * throws while the server starts.
 */
export function accessConfig(env: Record<string, string | undefined>): AccessConfig | null {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();
  if (!team || !audience) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(team) ? team : `https://${team}`);
    return { teamDomain: url.origin, audience };
  } catch {
    return null;
  }
}

/**
 * The origin lock (docs/runbooks/go-public.md → Lock the origin): a secret
 * request header that a Cloudflare Transform Rule adds, so the web service
 * can tell a request that came through Cloudflare from one sent straight to
 * Railway's edge with the site's Host. Unset: no lock (local, and production
 * until the rule exists). Compared in constant time.
 */
export const ORIGIN_AUTH_HEADER = 'x-origin-auth';

export function originSecret(env: Record<string, string | undefined>): string | null {
  return env.ORIGIN_AUTH_SECRET?.trim() || null;
}

/** Whether `sent` is the secret, without leaking where they differ. */
export function originAllowed(sent: string | null, secret: string): boolean {
  if (sent === null) return false;
  const a = new TextEncoder().encode(sent);
  const b = new TextEncoder().encode(secret);
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

function base64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64url(part)));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type KeyLookup = (kid: string) => Promise<CryptoKey | null>;

/** Checks a token's signature, issuer, audience and times (30 s of clock skew allowed). */
export async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  key: KeyLookup,
  now = Date.now(),
): Promise<AccessResult> {
  const parts = token.split('.');
  const [head, body, signature] = parts;
  if (parts.length !== 3 || !head || !body || !signature) return { ok: false, reason: 'malformed' };
  const header = decodeJson(head);
  const claims = decodeJson(body);
  if (!header || !claims) return { ok: false, reason: 'malformed' };
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    return { ok: false, reason: 'algorithm' };
  }
  const publicKey = await key(header.kid);
  if (!publicKey) return { ok: false, reason: 'unknown key' };
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      base64url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature' };
  if (claims.iss !== config.teamDomain) return { ok: false, reason: 'issuer' };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.audience)) return { ok: false, reason: 'audience' };
  const seconds = now / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < seconds - 30) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf > seconds + 30) {
    return { ok: false, reason: 'not yet valid' };
  }
  // A person has an email; a service token has its client id as common_name.
  const subject =
    typeof claims.email === 'string'
      ? 'person'
      : typeof claims.common_name === 'string'
        ? 'service'
        : 'unknown';
  return { ok: true, subject };
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

/** The team's keys, fetched from Cloudflare and cached (see the top of this file). */
export function teamKeys(
  config: AccessConfig,
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
  clock: () => number = Date.now,
): KeyLookup {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = -Infinity;
  let pending: Promise<void> | null = null;

  const refresh = () => {
    pending ??= (async () => {
      try {
        const response = await fetcher(`${config.teamDomain}/cdn-cgi/access/certs`);
        if (!response.ok) return;
        const data = (await response.json()) as { keys?: Jwk[] };
        const next = new Map<string, CryptoKey>();
        for (const jwk of data.keys ?? []) {
          if (!jwk.kid || jwk.kty !== 'RSA') continue;
          next.set(
            jwk.kid,
            await crypto.subtle.importKey(
              'jwk',
              { kty: jwk.kty, n: jwk.n, e: jwk.e },
              { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
              false,
              ['verify'],
            ),
          );
        }
        if (next.size > 0) {
          keys = next;
          fetchedAt = clock();
        }
      } catch {
        // Cloudflare unreachable: keep the keys we have; tokens with new keys fail until it answers.
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  let lastAttempt = -Infinity;
  const attempt = async (minGapMs: number) => {
    if (clock() - lastAttempt < minGapMs) return;
    lastAttempt = clock();
    await refresh();
  };
  return async (kid) => {
    if (clock() - fetchedAt > 60 * 60 * 1000) await attempt(10 * 1000);
    if (!keys.has(kid)) await attempt(60 * 1000);
    return keys.get(kid) ?? null;
  };
}
