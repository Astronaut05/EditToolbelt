/**
 * POST /api/v1/uploads (docs/06): `{ tool_id, bytes, mime }` → a multipart
 * upload straight to storage, with the first part URLs. Signed-in callers,
 * or a key with `jobs:write`; the file itself never passes through this server.
 */
import { z } from 'zod';

import { json, rateLimit, readJson, preflight, requireCaller, route } from '../../../../server/api';
import { createUpload } from '../../../../server/uploads';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const Body = z.strictObject({
  tool_id: z.string().min(1).max(64),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  mime: z.string().min(3).max(127),
});

export const POST = route('uploads.create', async (request) => {
  const { user, ref } = await requireCaller(request, 'jobs:write');
  const limits = rateLimit(`uploads:${ref}`, 30, 60);
  const body = await readJson(request, Body);
  const upload = await createUpload(user, {
    toolId: body.tool_id,
    bytes: body.bytes,
    mime: body.mime,
  });
  return json(upload, { status: 201, headers: limits });
});
