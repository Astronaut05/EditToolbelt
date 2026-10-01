/**
 * POST /api/v1/uploads/:id/complete (docs/06): `{ parts: [{ n, etag }] }`
 * joins the parts in storage, checks the size and hands the file to the
 * worker to probe. Completing twice answers the same.
 */
import { MAX_PARTS } from '@etb/core/upload';
import { z } from 'zod';

import { json, readJson, preflight, requireCaller, route } from '../../../../../../server/api';
import { completeUpload } from '../../../../../../server/uploads';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const Body = z.strictObject({
  parts: z
    .array(
      z.strictObject({
        n: z.number().int().min(1).max(MAX_PARTS),
        etag: z.string().min(1).max(130),
      }),
    )
    .min(1)
    .max(MAX_PARTS),
});

type Context = { params: Promise<{ id: string }> };

export const POST = route('uploads.complete', async (request, { params }: Context) => {
  const { user } = await requireCaller(request, 'jobs:write');
  // 10,000 parts with ETags fit in about 700 KB.
  const body = await readJson(request, Body, 1024 * 1024);
  return json(await completeUpload(user, (await params).id, body.parts));
});
