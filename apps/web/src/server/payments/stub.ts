/**
 * A stand-in provider for the server build's end-to-end tests
 * (PAYMENTS_STUB=paddle|click|payme, refused unless APP_ENV=test): it takes
 * the place of that provider, sends the buyer straight to the return page and
 * pays when a test posts to its webhook with PAYMENTS_STUB_KEY. Everything
 * around it is the real thing: the switches, checkout, the store, the ledger.
 * Never a real provider's protocol.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { PaymentProvider, ProviderId } from './contract';
import { creditsForRefund, readBody } from './providers/shared';
import { returnUrl } from './urls';

export const STUB_KEY = 'PAYMENTS_STUB_KEY';

const Call = z.strictObject({
  purchase_id: z.string(),
  action: z.enum(['complete', 'cancel', 'refund']),
  refund_id: z.string().optional(),
  credits: z.number().int().positive().optional(),
});

function authorised(request: Request, key: string | undefined): boolean {
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${key ?? ''}`);
  return Boolean(key) && given.length === expected.length && timingSafeEqual(given, expected);
}

/** The body as JSON, read with the webhooks' size cap; null when it's too big or not JSON. */
async function readJson(request: Request): Promise<unknown> {
  const body = await readBody(request);
  try {
    return body ? (JSON.parse(body.toString('utf8')) as unknown) : null;
  } catch {
    return null;
  }
}

export function stubProvider(id: ProviderId): PaymentProvider {
  return {
    id,
    currency: id === 'paddle' ? 'USD' : 'UZS',
    requiredEnv: [STUB_KEY],
    async createCheckout(purchase, _buyer, ctx) {
      await ctx.store.attach(purchase.id, `stub_${purchase.id}`);
      return { kind: 'redirect', url: returnUrl(ctx.siteUrl, purchase.id) };
    },
    async handleWebhook(request, ctx) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      if (!authorised(request, ctx.env[STUB_KEY])) return new Response(null, { status: 401 });
      const call = Call.safeParse(await readJson(request));
      if (!call.success) return Response.json({ error: 'bad call' }, { status: 400 });
      const { purchase_id: purchaseId, action } = call.data;
      const event = await ctx.store.recordEvent(
        id,
        `${action}:${purchaseId}:${call.data.refund_id ?? ''}`,
        action,
        call.data,
      );
      const purchase = await ctx.store.get(purchaseId);
      if (!purchase || purchase.provider !== id) {
        await ctx.store.markEventProcessed(event.id, 'unknown purchase');
        return Response.json({ error: 'unknown purchase' }, { status: 404 });
      }
      const done =
        action === 'complete'
          ? await ctx.store.complete(purchaseId)
          : action === 'cancel'
            ? await ctx.store.cancel(purchaseId)
            : await ctx.store.refund(purchaseId, {
                refundId: call.data.refund_id ?? `stub_refund_${purchaseId}`,
                ...(call.data.credits !== undefined && { credits: call.data.credits }),
              });
      await ctx.store.markEventProcessed(event.id);
      return Response.json({ status: done.status });
    },
    async refund(purchase, ctx, amountMinor) {
      // Applied at once, in proportion to the money, as the real refund call would.
      const credits = creditsForRefund(purchase.credits, amountMinor, purchase.amountMinor);
      await ctx.store.refund(purchase.id, {
        refundId: `stub_refund_${randomUUID()}`,
        ...(credits === undefined ? {} : { credits }),
      });
    },
  };
}
