/**
 * POST /api/v1/auth/device (docs/06 → Auth): the panel starts connecting.
 * `{ client_name? }` → a device code for the panel to poll with and a short
 * code for the person to approve at /connect. Anonymous; limited per address.
 */
import { z } from 'zod';

import { json, preflight, rateLimit, readJson, route, sourceOf } from '../../../../../server/api';
import {
  CODE_TTL_SEC,
  formatUserCode,
  POLL_INTERVAL_SEC,
  startDevice,
} from '../../../../../server/device';
import { serverEnv } from '../../../../../server/env';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const Body = z.strictObject({
  client_name: z.string().trim().min(1).max(60).optional(),
});

export const POST = route('auth.device', async (request) => {
  const limits = rateLimit(`device:${sourceOf(request)}`, 20, 60);
  const body = await readJson(request, Body);
  const { deviceCode, userCode } = await startDevice(body.client_name ?? 'Premiere panel');
  const connect = new URL('/connect', serverEnv().SITE_URL);
  const shown = formatUserCode(userCode);
  return json(
    {
      device_code: deviceCode,
      user_code: shown,
      verification_uri: connect.href,
      verification_uri_complete: `${connect.href}?code=${shown}`,
      expires_in: CODE_TTL_SEC,
      interval: POLL_INTERVAL_SEC,
    },
    { headers: limits },
  );
});
