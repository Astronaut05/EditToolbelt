/**
 * POST /api/v1/jobs/quote (docs/06): `{ tool_id, upload_id, options }` → the
 * price from the worker's probe, what pays for it and the balance after.
 * While the worker is still probing it answers 202 `{ status: "probing" }`
 * with `Retry-After`; ask again.
 */
import { z } from 'zod';

import {
  json,
  rateLimit,
  readJson,
  requireSameOrigin,
  requireUser,
  route,
} from '../../../../../server/api';
import { quote } from '../../../../../server/jobs';

export const dynamic = 'force-dynamic';

const Body = z.strictObject({
  tool_id: z.string().min(1).max(64),
  upload_id: z.string().min(1).max(64),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const POST = route('jobs.quote', async (request) => {
  requireSameOrigin(request);
  const user = await requireUser();
  const limits = rateLimit(`jobs.quote:${user.id}`, 60, 60);
  const body = await readJson(request, Body);
  const answer = await quote(user, {
    toolId: body.tool_id,
    uploadId: body.upload_id,
    options: body.options,
  });
  if (answer.status === 'probing') {
    return json(answer, { status: 202, headers: { ...limits, 'Retry-After': '1' } });
  }
  return json(answer, { headers: limits });
});
