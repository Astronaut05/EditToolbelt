/**
 * GET /api/v1/openapi.json (docs/06 → Basics): the OpenAPI 3.1 document, made
 * from the same schemas the routes read their bodies with.
 */
import { openApiDocument } from '@etb/core/api';

import { preflight, route } from '../../../../server/api';
import { serverEnv } from '../../../../server/env';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

let made: string | undefined;

export const GET = route('openapi', () => {
  made ??= JSON.stringify(openApiDocument(serverEnv().SITE_URL));
  return Promise.resolve(
    new Response(made, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    }),
  );
});
