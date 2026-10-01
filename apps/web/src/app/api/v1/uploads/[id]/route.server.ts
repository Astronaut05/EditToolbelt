/** DELETE /api/v1/uploads/:id: give up on an upload; its parts or file go now. */
import { json, requireSameOrigin, requireUser, route } from '../../../../../server/api';
import { cancelUpload } from '../../../../../server/uploads';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const DELETE = route('uploads.cancel', async (request, { params }: Context) => {
  requireSameOrigin(request);
  const user = await requireUser();
  await cancelUpload(user, (await params).id);
  return json({ status: 'cancelled' });
});
