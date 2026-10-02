/**
 * Shared plumbing for `/api/v1` routes (docs/06): errors as RFC 9457
 * problem+json with a stable `code`, JSON bodies checked by Zod, the caller,
 * and per-caller rate limits with `RateLimit-*` headers.
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

export { ApiError, json, problem, type ApiCode } from './problem';
export { rateLimit } from './rate-limit';

/**
 * Wraps a route handler: an ApiError becomes its problem answer; anything
 * else is logged (no request body, no file data) and answered as a 500.
 */
export function route<A extends unknown[]>(
  name: string,
  handler: (request: Request, ...rest: A) => Promise<Response>,
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    let response: Response;
    try {
      response = await handler(request, ...rest);
    } catch (error) {
      if (error instanceof ApiError) {
        response = problem(error);
      } else {
        log.error({ err: error, route: name }, 'api.failed');
        response = problem(new ApiError(500, 'INTERNAL', 'Something went wrong on our side'));
      }
    }
    for (const [header, value] of Object.entries(CORS)) response.headers.set(header, value);
    return response;
  };
}

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

/** Reads a JSON body of at most `maxBytes` and checks it with `schema`. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = 64 * 1024,
): Promise<z.output<S>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'BAD_REQUEST', 'Send JSON', 'Content-Type must be application/json.');
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, 'BAD_REQUEST', 'Request body too large');
  }
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
 * Where an anonymous call comes from, for its rate limit: the address
 * Cloudflare or a reverse proxy passes. Only compared, never kept or logged.
 */
export function sourceOf(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'direct'
  );
}

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
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Who is calling: an API key in `Authorization: Bearer` that holds `scope`,
 * or the session cookie (which can do everything its account can). 401 for
 * a bad key or no session, 403 for a key without the scope.
 */
export async function requireCaller(request: Request, scope: Scope): Promise<Caller> {
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
    if (!caller.scopes.includes(scope)) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'This key can’t do that',
        `It needs the ${scope} scope.`,
      );
    }
    return { user: caller.user, keyId: caller.keyId, ref: `key:${caller.keyId}` };
  }
  if (WRITES.has(request.method)) requireSameOrigin(request);
  const user = await requireUser();
  return { user, keyId: null, ref: `user:${user.id}` };
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
