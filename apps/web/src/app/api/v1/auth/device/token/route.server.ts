/**
 * POST /api/v1/auth/device/token (docs/06 → Auth): the panel polls with
 * `{ device_code }` every 5 s. Once the person approves, the answer is an API
 * key, given this once; until then a problem with AUTHORIZATION_PENDING.
 */
import { z } from 'zod';

import {
  json,
  preflight,
  rateLimit,
  readJson,
  route,
  sourceOf,
} from '../../../../../../server/api';
import { collectKey } from '../../../../../../server/device';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const Body = z.strictObject({
  device_code: z.string().min(16).max(128),
});

export const POST = route('auth.device.token', async (request) => {
  const limits = rateLimit(`device.token:${sourceOf(request)}`, 60, 60);
  const body = await readJson(request, Body);
  const collected = await collectKey(body.device_code);
  return json(
    {
      api_key: collected.key,
      key_prefix: collected.prefix,
      name: collected.name,
      scopes: collected.scopes,
    },
    { headers: limits },
  );
});
