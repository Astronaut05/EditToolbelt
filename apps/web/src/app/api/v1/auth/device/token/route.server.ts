/**
 * POST /api/v1/auth/device/token (docs/06 → Auth): the panel polls with
 * `{ device_code }` every 5 s. Once the person approves, the answer is an API
 * key, given this once; until then a problem with AUTHORIZATION_PENDING.
 */
import { DeviceTokenRequest, type DeviceToken } from '@etb/core/api';

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

export const POST = route('auth.device.token', async (request) => {
  const limits = rateLimit(`device.token:${sourceOf(request)}`, 60, 60);
  const body = await readJson(request, DeviceTokenRequest);
  const collected = await collectKey(body.device_code);
  const answer: DeviceToken = {
    api_key: collected.key,
    key_prefix: collected.prefix,
    name: collected.name,
    scopes: collected.scopes,
  };
  return json(answer, { headers: limits });
});
