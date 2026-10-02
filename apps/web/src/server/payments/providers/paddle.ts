/**
 * Paddle Billing, API v1: worldwide, USD, merchant of record (docs/05 →
 * Payments; docs/DECISIONS.md → "Paddle: the overlay checkout, and what its
 * webhooks change").
 *
 * - Checkout: a transaction made on our server for the purchase (catalog
 *   price when config/business.ts has one, otherwise a non-catalog USD price),
 *   `custom_data.purchase_id`, the buyer's Paddle customer when we know the
 *   email. The buyer pays in the Paddle.js overlay on /credits/buy.
 * - Webhooks: `Paddle-Signature` checked first (HMAC-SHA256 of `ts:body`,
 *   5 minutes either way), stored once per event_id, then:
 *   `transaction.paid` / `transaction.completed` complete the purchase;
 *   approved `refund` and `chargeback` adjustments take the credits back.
 * - Refund: a full refund adjustment through the API; the credits go when
 *   Paddle approves it and says so by webhook.
 */
import { createHmac } from 'node:crypto';

import { paddlePriceIds } from '@etb/config/business';

import { ApiError, json, problem } from '../../problem';
import type { Checkout, PaymentProvider, ProviderContext, PurchaseRecord } from '../contract';
import {
  asString,
  assertCheckoutable,
  describeError,
  isRecord,
  packFor,
  ProviderConfigError,
  readBody,
  readEnv,
  safeEqual,
} from './shared';

export const PADDLE_ENV = [
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_ENVIRONMENT',
  'PADDLE_CLIENT_TOKEN',
] as const;

export const PADDLE_API = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

export type PaddleEnvironment = keyof typeof PADDLE_API;

/** A signature further than this from our clock, either way, is refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** A Paddle API call failed. The message carries the HTTP status and Paddle's error code only. */
export class PaddleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    operation: string,
  ) {
    super(`Paddle API: ${operation} failed with HTTP ${String(status)}${code ? ` (${code})` : ''}`);
    this.name = 'PaddleApiError';
  }
}

export function paddleEnvironment(ctx: ProviderContext): PaddleEnvironment {
  const value = ctx.env.PADDLE_ENVIRONMENT?.trim();
  if (value === 'sandbox' || value === 'production') return value;
  throw new ProviderConfigError('paddle', 'PADDLE_ENVIRONMENT must be sandbox or production');
}

async function paddleApi(
  ctx: ProviderContext,
  operation: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { PADDLE_API_KEY } = readEnv(ctx, 'paddle', ['PADDLE_API_KEY']);
  const response = await ctx.fetch(`${PADDLE_API[paddleEnvironment(ctx)]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isRecord(parsed) && isRecord(parsed.error) ? asString(parsed.error.code) : null;
    throw new PaddleApiError(response.status, code, operation);
  }
  if (!isRecord(parsed) || !('data' in parsed))
    throw new PaddleApiError(response.status, 'unexpected_response', operation);
  return parsed.data;
}

/** The buyer's Paddle customer (found by exact email, or made), or null if Paddle won't say. */
async function customerFor(email: string, ctx: ProviderContext): Promise<string | null> {
  try {
    const found = await paddleApi(
      ctx,
      'list customers',
      'GET',
      `/customers?email=${encodeURIComponent(email)}`,
    );
    if (Array.isArray(found)) {
      for (const customer of found) {
        const id = isRecord(customer) ? asString(customer.id) : null;
        if (id?.startsWith('ctm_')) return id;
      }
    }
    const created = await paddleApi(ctx, 'create customer', 'POST', '/customers', { email });
    const id = isRecord(created) ? asString(created.id) : null;
    return id?.startsWith('ctm_') ? id : null;
  } catch {
    // Checkout works without it: the overlay asks for the email instead.
    return null;
  }
}

function transactionItem(
  purchase: PurchaseRecord,
  catalogPriceId: string,
): Record<string, unknown> {
  if (catalogPriceId) return { price_id: catalogPriceId, quantity: 1 };
  const credits = packFor(purchase.packId).credits;
  return {
    quantity: 1,
    price: {
      name: `${String(credits)} credits`,
      description: `${String(credits)} EditToolbelt credits`,
      unit_price: { amount: String(purchase.amountMinor), currency_code: 'USD' },
      // Pack prices include tax (config/business.ts).
      tax_mode: 'internal',
      quantity: { minimum: 1, maximum: 1 },
      product: {
        name: `EditToolbelt credits: ${String(credits)}`,
        description: 'Credits for the server tools on EditToolbelt. They never expire.',
        tax_category: 'standard',
      },
    },
  };
}

function priceIdOf(item: unknown): string | null {
  if (!isRecord(item)) return null;
  return (isRecord(item.price) ? asString(item.price.id) : null) ?? asString(item.price_id);
}

/**
 * True when `header` (`ts=…;h1=…`, possibly several h1 while a secret
 * rotates) signs `ts:body` with `secret`, and ts is within 5 minutes of now.
 */
export function verifyPaddleSignature(
  header: string | null,
  body: Buffer | string,
  secret: string,
  now: Date,
): boolean {
  if (!header) return false;
  let ts: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1' && value !== '') signatures.push(value);
  }
  if (ts === null || !/^\d{1,12}$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${ts}:`).update(body).digest('hex');
  let valid = false;
  for (const signature of signatures) valid = safeEqual(signature, expected) || valid;
  return valid;
}

interface PaddleEvent {
  eventId: string;
  type: string;
  data: Record<string, unknown>;
}

function parseEvent(payload: unknown): PaddleEvent | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const eventId = asString(payload.event_id);
  const type = asString(payload.event_type);
  if (!eventId || !type) return null;
  return { eventId, type, data: payload.data };
}

/** Why a paid transaction can't complete its purchase as is, or null when it can. */
function itemsMismatch(
  transaction: Record<string, unknown>,
  purchase: PurchaseRecord,
): string | null {
  const items: unknown[] = Array.isArray(transaction.items) ? transaction.items : [];
  const [item] = items;
  if (items.length !== 1 || !isRecord(item))
    return 'the transaction no longer has exactly one item';
  if (item.quantity !== 1) return 'the transaction quantity is not 1';
  const expected = asString(purchase.providerData.priceId);
  if (expected && priceIdOf(item) !== expected)
    return 'the transaction price is not the one checkout created';
  return null;
}

/** transaction.paid and transaction.completed: whichever arrives first credits, the other finds it done. */
async function onPaid(
  transaction: Record<string, unknown>,
  ctx: ProviderContext,
): Promise<string | undefined> {
  const transactionId = asString(transaction.id);
  const status = asString(transaction.status);
  if (!transactionId) return 'transaction without an id';
  if (status !== 'paid' && status !== 'completed')
    return `transaction status is ${status ?? 'missing'}, not paid`;
  // Bound by the id our server attached at checkout: custom_data alone could
  // come from a checkout opened in the browser for another price.
  const purchase = await ctx.store.byProviderTxn('paddle', transactionId);
  if (!purchase) return 'no purchase has this transaction';
  if (purchase.status === 'cancelled')
    return 'paid after the purchase was cancelled: refund it or add the credits by hand';
  if (purchase.status !== 'pending') return undefined; // already completed: nothing to do
  const mismatch = itemsMismatch(transaction, purchase);
  if (mismatch) return `not credited: ${mismatch}`;
  const totals =
    isRecord(transaction.details) && isRecord(transaction.details.totals)
      ? transaction.details.totals
      : {};
  await ctx.store.complete(purchase.id, {
    paidTotal: asString(totals.grand_total),
    paidCurrency: asString(transaction.currency_code),
    paidAt: ctx.now().toISOString(),
  });
  return undefined;
}

async function paidTotalOf(purchase: PurchaseRecord, ctx: ProviderContext): Promise<number> {
  const stored = Number(purchase.providerData.paidTotal);
  if (stored > 0) return stored;
  const transaction = await paddleApi(
    ctx,
    'get transaction',
    'GET',
    `/transactions/${encodeURIComponent(purchase.providerTxnId ?? '')}`,
  );
  const details = isRecord(transaction) && isRecord(transaction.details) ? transaction.details : {};
  return Number(isRecord(details.totals) ? details.totals.grand_total : NaN);
}

/** Credits a refund takes: undefined for all that's left, otherwise in proportion to the money. */
async function refundCredits(
  adjustment: Record<string, unknown>,
  purchase: PurchaseRecord,
  ctx: ProviderContext,
): Promise<number | undefined> {
  if (adjustment.type === 'full') return undefined;
  const items = Array.isArray(adjustment.items) ? adjustment.items.filter(isRecord) : [];
  if (items.length > 0 && items.every((item) => item.type === 'full')) return undefined;
  const refunded = Number(isRecord(adjustment.totals) ? adjustment.totals.total : NaN);
  const paid = await paidTotalOf(purchase, ctx);
  if (!(refunded > 0) || !(paid > 0)) throw new Error('Cannot size a partial refund');
  if (refunded >= paid) return undefined;
  return Math.min(purchase.credits, Math.max(1, Math.round((purchase.credits * refunded) / paid)));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** adjustment.created and adjustment.updated: approved refunds and chargebacks take credits back. */
async function onAdjustment(
  adjustment: Record<string, unknown>,
  ctx: ProviderContext,
): Promise<string | undefined> {
  const adjustmentId = asString(adjustment.id);
  const action = asString(adjustment.action);
  const status = asString(adjustment.status);
  const transactionId = asString(adjustment.transaction_id);
  if (!adjustmentId || !action || !status || !transactionId)
    return 'adjustment without an id, action, status or transaction';
  if (action === 'chargeback_reverse' && status === 'approved')
    return 'chargeback reversed: give the credits back by hand';
  if (action !== 'refund' && action !== 'chargeback') return undefined;
  // pending_approval, rejected, reversed: no money moved back, so no credits either.
  if (status !== 'approved') return undefined;
  const purchase = await ctx.store.byProviderTxn('paddle', transactionId);
  if (!purchase) return 'no purchase has this transaction';
  const applied = stringList(purchase.providerData.adjustmentIds);
  if (applied.includes(adjustmentId)) return undefined;
  if (purchase.status !== 'completed' && purchase.status !== 'partially_refunded')
    return `${action} for a ${purchase.status} purchase: check it by hand`;
  const credits = await refundCredits(adjustment, purchase, ctx);
  await ctx.store.refund(
    purchase.id,
    {
      refundId: adjustmentId,
      ...(credits === undefined ? {} : { credits }),
      chargeback: action === 'chargeback',
    },
    { adjustmentIds: [...applied, adjustmentId] },
  );
  return undefined;
}

async function processEvent(event: PaddleEvent, ctx: ProviderContext): Promise<string | undefined> {
  switch (event.type) {
    case 'transaction.paid':
    case 'transaction.completed':
      return onPaid(event.data, ctx);
    case 'adjustment.created':
    case 'adjustment.updated':
      return onAdjustment(event.data, ctx);
    default:
      return undefined; // not ours to act on
  }
}

const fail = (status: number, code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'INTERNAL', title: string) =>
  problem(new ApiError(status, code, title));

export const paddle: PaymentProvider = {
  id: 'paddle',
  currency: 'USD',
  requiredEnv: PADDLE_ENV,

  async createCheckout(purchase, buyer, ctx): Promise<Checkout> {
    assertCheckoutable(purchase, 'paddle');
    const config = readEnv(ctx, 'paddle', PADDLE_ENV);
    const environment = paddleEnvironment(ctx);
    const overlay = (transactionId: string): Checkout => ({
      kind: 'paddle-overlay',
      transactionId,
      clientToken: config.PADDLE_CLIENT_TOKEN,
      environment,
    });
    // The buyer came back to the same purchase: same transaction.
    if (purchase.providerTxnId) return overlay(purchase.providerTxnId);

    const catalogPriceId =
      paddlePriceIds[environment === 'production' ? 'live' : 'sandbox'][purchase.packId];
    const customerId = buyer.email ? await customerFor(buyer.email, ctx) : null;
    const transaction = await paddleApi(ctx, 'create transaction', 'POST', '/transactions', {
      items: [transactionItem(purchase, catalogPriceId)],
      currency_code: 'USD',
      collection_mode: 'automatic',
      custom_data: { purchase_id: purchase.id },
      ...(customerId ? { customer_id: customerId } : {}),
    });
    const transactionId = isRecord(transaction) ? asString(transaction.id) : null;
    if (!transactionId?.startsWith('txn_'))
      throw new PaddleApiError(200, 'unexpected_response', 'create transaction');
    const items: unknown[] =
      isRecord(transaction) && Array.isArray(transaction.items) ? transaction.items : [];
    await ctx.store.attach(purchase.id, transactionId, {
      environment,
      priceId: priceIdOf(items[0]),
    });
    return overlay(transactionId);
  },

  async handleWebhook(request, ctx): Promise<Response> {
    const secret = ctx.env.PADDLE_WEBHOOK_SECRET?.trim();
    if (!secret) return fail(503, 'INTERNAL', 'Paddle is not set up');
    const body = await readBody(request);
    if (!body) return fail(413, 'BAD_REQUEST', 'Body too large');
    if (!verifyPaddleSignature(request.headers.get('paddle-signature'), body, secret, ctx.now()))
      return fail(401, 'UNAUTHORIZED', 'Bad or missing Paddle-Signature');

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return fail(400, 'BAD_REQUEST', 'Body is not JSON');
    }
    const event = parseEvent(payload);
    if (!event) return fail(400, 'BAD_REQUEST', 'Not a Paddle event');

    let eventRow: { id: string; fresh: boolean };
    try {
      eventRow = await ctx.store.recordEvent('paddle', event.eventId, event.type, payload);
    } catch {
      return fail(500, 'INTERNAL', 'Could not store the event');
    }
    if (!eventRow.fresh) return json({ ok: true, duplicate: true });
    try {
      const note = await processEvent(event, ctx);
      await ctx.store.markEventProcessed(eventRow.id, note);
      return json({ ok: true });
    } catch (error) {
      await ctx.store.markEventProcessed(eventRow.id, describeError(error)).catch(() => undefined);
      return fail(500, 'INTERNAL', 'Could not process the event');
    }
  },

  async refund(purchase, ctx): Promise<void> {
    if (purchase.provider !== 'paddle' || !purchase.providerTxnId)
      throw new Error('Not a paid Paddle purchase');
    if (purchase.status !== 'completed')
      throw new Error(
        `A ${purchase.status} purchase can't be refunded in full here; use Paddle's dashboard`,
      );
    const adjustment = await paddleApi(ctx, 'create adjustment', 'POST', '/adjustments', {
      action: 'refund',
      transaction_id: purchase.providerTxnId,
      type: 'full',
      reason: 'Refund of unused credits, requested through EditToolbelt',
    });
    const adjustmentId = isRecord(adjustment) ? asString(adjustment.id) : null;
    // Credits go when Paddle approves the refund (adjustment.created/updated, status approved).
    await ctx.store.updateData(purchase.id, {
      refundRequestedAt: ctx.now().toISOString(),
      refundRequestId: adjustmentId,
    });
  },
};
