/**
 * POST /api/v1/uploads/:id/parts (docs/06): `{ from, count }` → fresh part
 * URLs. They expire after 15 minutes, so long uploads fetch them in batches.
 */
import { PartList, PartsRequest } from '@etb/core/api';

import {
  json,
  limit,
  readJson,
  preflight,
  requireCaller,
  route,
} from '../../../../../../server/api';
import { partUrls } from '../../../../../../server/uploads';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const POST = route('uploads.parts', async (request, { params }: Context) => {
  const { user, ref } = await requireCaller(request, 'jobs:write');
  limit(request, `upload-parts:${ref}`, 600, 60);
  const body = await readJson(request, PartsRequest);
  const parts = await partUrls(user, (await params).id, body.from, body.count);
  return json(parts satisfies PartList);
});
