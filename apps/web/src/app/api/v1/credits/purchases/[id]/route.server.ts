/**
 * GET /api/v1/credits/purchases/:id (web only): one of the signed-in user's
 * purchases, for /credits/return to follow until the provider confirms it.
 * Someone else's purchase is "not found".
 */
import { json, preflight, rateLimit, requireSession, route } from '../../../../../../server/api';
import { db } from '../../../../../../server/db';
import { ownPurchase, purchaseView } from '../../../../../../server/payments/checkout';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const GET = route('credits.purchase', async (request, { params }: Context) => {
  const user = await requireSession(request);
  const limits = rateLimit(`purchases:user:${user.id}`, 120, 60);
  const row = await ownPurchase(db(), user.id, (await params).id);
  return json(purchaseView(row), { headers: limits });
});
