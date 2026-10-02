/**
 * POST /api/v1/credits/checkout `{ pack_id, provider }` (docs/05, docs/06:
 * web only): the website's signed-in user starts buying a pack. Answers
 * `{ purchase_id, checkout }`: a URL to send the browser to, or Paddle's
 * overlay. 404 while payments or that provider are off. API keys can't buy.
 */
import { CheckoutRequest } from '../../../../../lib/checkout';
import { json, limit, preflight, readJson, requireSession, route } from '../../../../../server/api';
import { db } from '../../../../../server/db';
import { PAYMENTS_OFF, startCheckout } from '../../../../../server/payments/checkout';
import { canBuyCredits } from '../../../../../server/payments/switches';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const POST = route('credits.checkout', async (request) => {
  // Off: a 404 before anything else, signed in or not.
  if (!(await canBuyCredits(db()))) throw PAYMENTS_OFF();
  const user = await requireSession(request);
  limit(request, `checkout:user:${user.id}`, 10, 60);
  const body = await readJson(request, CheckoutRequest, 4 * 1024);
  const answer = await startCheckout(db(), user, {
    packId: body.pack_id,
    provider: body.provider,
  });
  return json(answer, { status: 201 });
});
