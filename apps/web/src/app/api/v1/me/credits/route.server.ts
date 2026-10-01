/**
 * GET /api/v1/me/credits (docs/06): the caller's credit history, newest
 * first, 50 a page by `?cursor=`.
 */
import { json, preflight, rateLimit, requireCaller, route } from '../../../../../server/api';
import { creditHistory } from '../../../../../server/account';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const GET = route('me.credits', async (request) => {
  const { user, ref } = await requireCaller(request, 'account:read');
  const limits = rateLimit(`me:${ref}`, 120, 60);
  const cursor = new URL(request.url).searchParams.get('cursor');
  return json(await creditHistory(user.id, cursor), { headers: limits });
});
