/**
 * POST /api/v1/uploads/:id/parts (docs/06): `{ from, count }` → fresh part
 * URLs. They expire after 15 minutes, so long uploads fetch them in batches.
 */
import { MAX_PART_BATCH } from '@etb/core/upload';
import { z } from 'zod';

import {
  json,
  rateLimit,
  readJson,
  requireSameOrigin,
  requireUser,
  route,
} from '../../../../../../server/api';
import { partUrls } from '../../../../../../server/uploads';

export const dynamic = 'force-dynamic';

const Body = z.strictObject({
  from: z.number().int().min(1),
  count: z.number().int().min(1).max(MAX_PART_BATCH),
});

type Context = { params: Promise<{ id: string }> };

export const POST = route('uploads.parts', async (request, { params }: Context) => {
  requireSameOrigin(request);
  const user = await requireUser();
  const limits = rateLimit(`upload-parts:${user.id}`, 600, 60);
  const body = await readJson(request, Body);
  return json(await partUrls(user, (await params).id, body.from, body.count), { headers: limits });
});
