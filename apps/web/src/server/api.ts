/**
 * Shared plumbing for `/api/v1` routes (docs/06): errors as RFC 9457
 * problem+json with a stable `code`, JSON bodies checked by Zod, the caller,
 * and per-caller rate limits with `RateLimit-*` headers.
 *
 * The website calls the API with its session cookie. A write with a cookie
 * must come from our own origin (docs/06 → CORS: "our own origins only for
 * cookie auth"): the session cookie is SameSite=Lax already, and this refuses
 * anything else that carries it. API keys arrive with the Premiere panel (M7).
 */
import type { z } from 'zod';

import { log } from '../lib/log';
import { currentUser, type CurrentUser } from './account';
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
    try {
      return await handler(request, ...rest);
    } catch (error) {
      if (error instanceof ApiError) return problem(error);
      log.error({ err: error, route: name }, 'api.failed');
      return problem(new ApiError(500, 'INTERNAL', 'Something went wrong on our side'));
    }
  };
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

/** A write carrying our session cookie must come from our own origin. */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== new URL(serverEnv().SITE_URL).origin) {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-site request refused');
  }
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
