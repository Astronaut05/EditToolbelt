/**
 * POST /api/v1/uploads (docs/06): `{ tool_id, bytes, mime }` → a multipart
 * upload straight to storage, with the first part URLs. Signed-in callers,
 * or a key with `jobs:write`; the file itself never passes through this server.
 */
import { Upload, UploadCreate } from '@etb/core/api';

import { json, rateLimit, readJson, preflight, requireCaller, route } from '../../../../server/api';
import { createUpload } from '../../../../server/uploads';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const POST = route('uploads.create', async (request) => {
  const { user, ref } = await requireCaller(request, 'jobs:write');
  const limits = rateLimit(`uploads:${ref}`, 30, 60);
  const body = await readJson(request, UploadCreate);
  const upload = await createUpload(user, {
    toolId: body.tool_id,
    bytes: body.bytes,
    mime: body.mime,
  });
  return json(upload satisfies Upload, { status: 201, headers: limits });
});
