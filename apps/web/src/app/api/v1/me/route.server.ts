/**
 * GET /api/v1/me (docs/06): the caller's profile, tier, balance and free
 * server jobs left today. The server offer on tool pages reads it.
 */
import { json, rateLimit, requireUser, route } from '../../../../server/api';
import { me } from '../../../../server/jobs';

export const dynamic = 'force-dynamic';

export const GET = route('me', async () => {
  const user = await requireUser();
  const limits = rateLimit(`me:${user.id}`, 120, 60);
  return json(await me(user), { headers: limits });
});
