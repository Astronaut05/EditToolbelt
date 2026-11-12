/**
 * Better Auth over HTTP: only where an emailed link and Google's redirect
 * land, and its error page (src/server/auth.ts → authPathAllowed). Every
 * other endpoint answers 404 here; the site calls those on the server.
 */
import { toNextJsHandler } from 'better-auth/next-js';

import { auth, authPathAllowed } from '../../../../server/auth';
import { ApiError, problem } from '../../../../server/problem';

export const dynamic = 'force-dynamic';

const handlers = toNextJsHandler((request: Request) => auth().handler(request));

const guarded =
  (run: (request: Request) => Promise<Response>) =>
  (request: Request): Promise<Response> =>
    authPathAllowed(request.method, new URL(request.url).pathname)
      ? run(request)
      : Promise.resolve(problem(new ApiError(404, 'NOT_FOUND', 'Not found')));

export const GET = guarded(handlers.GET);
export const POST = guarded(handlers.POST);
