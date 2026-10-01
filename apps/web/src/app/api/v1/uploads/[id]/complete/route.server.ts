/**
 * POST /api/v1/uploads/:id/complete (docs/06): `{ parts: [{ n, etag }] }`
 * joins the parts in storage, checks the size and hands the file to the
 * worker to probe. Completing twice answers the same.
 */
import { UploadComplete, UploadDone } from '@etb/core/api';

import { json, readJson, preflight, requireCaller, route } from '../../../../../../server/api';
import { completeUpload } from '../../../../../../server/uploads';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const POST = route('uploads.complete', async (request, { params }: Context) => {
  const { user } = await requireCaller(request, 'jobs:write');
  // 10,000 parts with ETags fit in about 700 KB.
  const body = await readJson(request, UploadComplete, 1024 * 1024);
  return json((await completeUpload(user, (await params).id, body.parts)) satisfies UploadDone);
});
