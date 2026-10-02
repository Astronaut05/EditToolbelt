/**
 * GET /api/v1/me (docs/06): the caller's profile, tier, balance and free
 * server jobs left today. The server offer on tool pages reads it.
 */
import { json, preflight, limit, requireCaller, route } from '../../../../server/api';
import { me } from '../../../../server/jobs';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const GET = route('me', async (request) => {
  const { user, ref } = await requireCaller(request, 'account:read');
  limit(request, `me:${ref}`, 120, 60);
  return json(await me(user));
});
