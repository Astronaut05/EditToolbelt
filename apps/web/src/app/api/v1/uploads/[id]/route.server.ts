/** DELETE /api/v1/uploads/:id: give up on an upload; its parts or file go now. Twice answers the same. */
import type { UploadCancelled } from '@etb/core/api';

import { json, preflight, requireCaller, route } from '../../../../../server/api';
import { cancelUpload } from '../../../../../server/uploads';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const DELETE = route('uploads.cancel', async (request, { params }: Context) => {
  const { user } = await requireCaller(request, 'jobs:write');
  await cancelUpload(user, (await params).id);
  return json({ status: 'cancelled' } satisfies UploadCancelled);
});
