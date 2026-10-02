/**
 * Shared plumbing for `/api/v1` routes (docs/06): errors as RFC 9457
 * problem+json with a stable `code`, JSON bodies checked by Zod, the caller,
 * and per-caller rate limits with `RateLimit-*` headers on every answer.
 *
 * Rate limits (docs/06 → Basics), counted in this process:
 * - Every call counts against a general budget: per key or account once the
 *   caller is known (`requireCaller`), per address for anonymous routes and
 *   for calls whose key or session is refused.
 * - Routes add their own, stricter limits with `limit()`.
 * - Each answer, errors included, carries the `RateLimit-*` headers of the
 *   limit it is closest to.
 *
 * Two kinds of caller (docs/06 → Auth, CORS):
 * - The website, with its session cookie. A write with a cookie must come
 *   from our own origin: the cookie is SameSite=Lax already, and this refuses
 *   anything else that carries it.
 * - Scripts, the panel and other sites, with an API key in
 *   `Authorization: Bearer`, from any origin. Every answer allows any origin
 *   but never credentials, so a browser won't hand another site an answer
 *   made with our cookie.
 */
import type { z } from 'zod';

import { log } from '../lib/log';
import { currentUser, type CurrentUser } from './account';
import { keyCaller, type Scope } from './api-keys';
import { serverEnv } from './env';
import { ApiError, problem } from './problem';
import { countCall, rateLimit } from './rate-limit';

export { ApiError, json, problem, type ApiCode } from './problem';

/** The general budget per key, or per account for the website, a minute. */
export const CALLER_LIMIT = 600;
/** The general budget per address, a minute: anonymous calls and refused keys or sessions. */
export const ADDRESS_LIMIT = 300;

/** The `RateLimit-*` headers of each limit a request was counted against. */
const counted = new WeakMap<Request, Record<string, string>[]>();

/**
 * Counts this request against `key`'s limit (`max` a window of `windowSec`)
 * and remembers the headers for its answer. Throws 429 RATE_LIMITED past it.
 */
export function limit(
  request: Request,
  key: string,
  max: number,
  windowSec: number,
): Record<string, string> {
  const headers = rateLimit(key, max, windowSec);
  counted.set(request, [...(counted.get(request) ?? []), headers]);
  return headers;
}

const LIMIT_HEADERS = ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'] as const;

/**
 * Of several limits' headers, the one the caller is closest to: the fewest
 * calls left, then the longest wait.
 */
export function tightest(
  sets: readonly Record<string, string>[],
): Record<string, string> | undefined {
  let best: Record<string, string> | undefined;
  for (const set of sets) {
    if (!LIMIT_HEADERS.every((name) => set[name] !== undefined)) continue;
    if (!best) {
      best = set;
      continue;
    }
    const left = Number(set['RateLimit-Remaining']) - Number(best['RateLimit-Remaining']);
    const wait = Number(set['RateLimit-Reset']) - Number(best['RateLimit-Reset']);
    if (left < 0 || (left === 0 && wait > 0)) best = set;
  }
  return best;
}

/** Puts the tightest limit's headers on the answer, among those counted and its own. */
function applyLimits(request: Request, response: Response): void {
  const sets = [...(counted.get(request) ?? [])];
  const own = Object.fromEntries(
    LIMIT_HEADERS.flatMap((name) => {
      const value = response.headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
  if (Object.keys(own).length > 0) sets.push(own);
  if (sets.length === 0) {
    // Counted nowhere (it failed before knowing the caller): it still costs
    // its address one call, and says so.
    sets.push(countCall(`api:address:${sourceOf(request)}`, ADDRESS_LIMIT, 60).headers);
  }
  const chosen = tightest(sets);
  if (chosen) for (const name of LIMIT_HEADERS) response.headers.set(name, chosen[name] ?? '');
}

/** The general budget for a request whose caller isn't known: its address. */
const countAddress = (request: Request) =>
  limit(request, `api:address:${sourceOf(request)}`, ADDRESS_LIMIT, 60);

/**
 * Wraps a route handler: an ApiError becomes its problem answer; anything
 * else is logged (no request body, no file data) and answered as a 500.
 * Every answer gets the CORS and `RateLimit-*` headers. The handler counts
 * the call against its caller with `requireCaller`; a `publicRoute` counts
 * it against its address before the handler runs.
 */
export function route<A extends unknown[]>(
  name: string,
  handler: (request: Request, ...rest: A) => Promise<Response>,
  anonymous = false,
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    let response: Response;
    try {
      if (anonymous) countAddress(request);
      response = await handler(request, ...rest);
    } catch (error) {
      if (error instanceof ApiError) {
        response = problem(error);
      } else {
        log.error({ err: error, route: name }, 'api.failed');
        response = problem(new ApiError(500, 'INTERNAL', 'Something went wrong on our side'));
      }
    }
    applyLimits(request, response);
    for (const [header, value] of Object.entries(CORS)) response.headers.set(header, value);
    return response;
  };
}

/** A route anyone may call without a key (docs/06 → Auth): limited per address. */
export const publicRoute = <A extends unknown[]>(
  name: string,
  handler: (request: Request, ...rest: A) => Promise<Response>,
) => route(name, handler, true);

/** On every answer: any origin may read it, never with credentials (see above). */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, Location',
};

/** The answer to a CORS preflight; each `/api/v1` route exports it as `OPTIONS`. */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, Last-Event-ID',
      'Access-Control-Max-Age': '600',
    },
  });
}

const tooLarge = (maxBytes: number) =>
  new ApiError(413, 'BAD_REQUEST', 'Request body too large', `At most ${String(maxBytes)} bytes.`);

/**
 * The body as text, refused with 413 past `maxBytes`: at once when
 * `Content-Length` says so, otherwise as soon as that many bytes have come,
 * so an oversized body is never read whole.
 */
async function readCapped(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Malformed JSON', 'The body isn’t UTF-8.');
  }
}

/** Reads a JSON body of at most `maxBytes` and checks it with `schema`. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = 64 * 1024,
): Promise<z.output<S>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'BAD_REQUEST', 'Send JSON', 'Content-Type must be application/json.');
  }
  const text = await readCapped(request, maxBytes);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Malformed JSON');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'body';
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid request', `${where}: ${issue?.message ?? ''}`);
  }
  return parsed.data;
}

/**
 * Where a call comes from, for its rate limit: the address Cloudflare or a
 * reverse proxy passes. Only compared, never kept or logged.
 */
export function addressOf(headers: Pick<Headers, 'get'>): string {
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'direct'
  );
}

/** Where an API call comes from (`addressOf` its headers). */
export const sourceOf = (request: Request): string => addressOf(request.headers);

/** A write carrying our session cookie must come from our own origin. */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== new URL(serverEnv().SITE_URL).origin) {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-site request refused');
  }
}

export interface Caller {
  user: CurrentUser;
  /** The key the call came with; null for the website's session. */
  keyId: string | null;
  /** Rate limits count per key, or per account for the website. */
  ref: string;
  /** The key's scopes; the website's session can do everything. */
  scopes: readonly Scope[] | 'all';
}

/** Whether the caller holds `scope`: the website's session holds every one. */
export const holds = (caller: Pick<Caller, 'scopes'>, scope: Scope): boolean =>
  caller.scopes === 'all' || caller.scopes.includes(scope);

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Who is calling: an API key in `Authorization: Bearer` that holds `scope`,
 * or the session cookie (which can do everything its account can). 401 for
 * a bad key or no session, 403 for a key without the scope. Counts the call
 * against the caller's general budget, or its address's when it is refused.
 */
export async function requireCaller(request: Request, scope: Scope): Promise<Caller> {
  let caller: Caller;
  try {
    caller = await identify(request);
  } catch (error) {
    if (error instanceof ApiError) countAddress(request);
    throw error;
  }
  limit(request, `api:${caller.ref}`, CALLER_LIMIT, 60);
  if (!holds(caller, scope)) {
    throw new ApiError(403, 'FORBIDDEN', 'This key can’t do that', `It needs the ${scope} scope.`);
  }
  return caller;
}

async function identify(request: Request): Promise<Caller> {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const key = BEARER.exec(authorization.trim())?.[1];
    const caller = key ? await keyCaller(key) : null;
    if (!caller) {
      throw new ApiError(
        401,
        'UNAUTHORIZED',
        'Invalid API key',
        'The key is wrong or revoked, or its account is closed.',
        {},
        { 'WWW-Authenticate': 'Bearer' },
      );
    }
    return {
      user: caller.user,
      keyId: caller.keyId,
      ref: `key:${caller.keyId}`,
      scopes: caller.scopes,
    };
  }
  if (WRITES.has(request.method)) requireSameOrigin(request);
  const user = await requireUser();
  return { user, keyId: null, ref: `user:${user.id}`, scopes: 'all' };
}

/**
 * The website's signed-in user, never an API key (buying credits, docs/06:
 * web only). A write must come from our own origin.
 */
export async function requireSession(request: Request): Promise<CurrentUser> {
  if (request.headers.get('authorization') !== null) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'The website only',
      'Credits are bought on the website, signed in; API keys can’t buy them.',
    );
  }
  if (WRITES.has(request.method)) requireSameOrigin(request);
  return requireUser();
}

/** The signed-in caller, or 401. */
export async function requireUser(): Promise<CurrentUser> {
  const signedIn = await currentUser();
  if (!signedIn) {
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      'Sign in to use our servers',
      'Server processing needs an account. Browser tools work without one.',
    );
  }
  return signedIn.user;
}
