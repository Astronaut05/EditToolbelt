/**
 * Better Auth's endpoints: magic-link verify, Google callback, session, sign-out.
 * The two-factor ones answer 404 here; they work only on the server (src/server/auth.ts).
 */
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '../../../../server/auth';

export const dynamic = 'force-dynamic';

export const { GET, POST } = toNextJsHandler((request: Request) => auth().handler(request));
