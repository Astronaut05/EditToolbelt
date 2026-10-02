import { describe, expect, it } from 'vitest';

import { paddlePriceIds } from '@etb/config/business';

import type { PurchaseRecord } from '../contract';
import {
  paddle,
  PaddleApiError,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyPaddleSignature,
} from './paddle';
import { ProviderConfigError } from './shared';
import {
  adjustmentData,
  FakePaddleApi,
  paddleEvent,
  paddleId,
  paddleSignature,
  paddleWebhook,
  transactionData,
} from './sim/paddle';
import { Clock, testContext } from './testing/context';
import { MemoryPurchaseStore } from './testing/memory-store';

const SECRET = 'pdl_ntfset_01test_webhook_secret';
const KEY = 'pdl_sdbx_apikey_01test_key';
const ENV = {
  PADDLE_API_KEY: KEY,
  PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_ENVIRONMENT: 'sandbox',
  PADDLE_CLIENT_TOKEN: 'test_client_token',
};

function setup(
  options: { env?: Record<string, string | undefined>; store?: MemoryPurchaseStore } = {},
) {
  const clock = new Clock();
  const store = options.store ?? new MemoryPurchaseStore(clock.now);
  const env = { ...ENV, ...options.env };
  const host =
    env.PADDLE_ENVIRONMENT === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
  const api = new FakePaddleApi(KEY, host);
  const ctx = testContext({ store, env, clock, fetch: api.fetch });
  return { clock, store, api, ctx };
}

type Setup = ReturnType<typeof setup>;

/** A purchase with a Paddle transaction made through createCheckout. */
async function checkedOut(s: Setup, packId: 'starter' | 'creator' | 'studio' = 'starter') {
  const purchase = s.store.seed({ provider: 'paddle', packId });
  const checkout = await paddle.createCheckout(purchase, { email: null }, s.ctx);
  if (checkout.kind !== 'paddle-overlay') throw new Error('expected the overlay');
  const transaction = s.api.transactions.get(checkout.transactionId);
  if (!transaction) throw new Error('no transaction');
  return {
    purchase: s.store.peek(purchase.id),
    transaction,
    transactionId: checkout.transactionId,
  };
}

async function deliver(s: Setup, type: string, data: Record<string, unknown>, eventId?: string) {
  const event = paddleEvent(type, data, eventId);
  const response = await paddle.handleWebhook(
    paddleWebhook(event, SECRET, { now: s.clock.now() }),
    s.ctx,
  );
  return { response, event };
}

async function paid(s: Setup, packId: 'starter' | 'creator' | 'studio' = 'starter') {
  const done = await checkedOut(s, packId);
  await deliver(s, 'transaction.completed', { ...done.transaction, status: 'completed' });
  return { ...done, purchase: s.store.peek(done.purchase.id) };
}

describe('Paddle checkout', () => {
  it('creates a non-catalog USD transaction for the purchase and opens the overlay', async () => {
    const s = setup();
    const purchase = s.store.seed({ provider: 'paddle', packId: 'starter' });
    const checkout = await paddle.createCheckout(purchase, { email: null }, s.ctx);

    expect(checkout).toMatchObject({
      kind: 'paddle-overlay',
      clientToken: 'test_client_token',
      environment: 'sandbox',
    });
    if (checkout.kind !== 'paddle-overlay') return;
    expect(checkout.transactionId).toMatch(/^txn_/);

    const [call] = s.api.calls;
    expect(call).toMatchObject({ method: 'POST', path: '/transactions' });
    expect(call?.body).toMatchObject({
      currency_code: 'USD',
      collection_mode: 'automatic',
      custom_data: { purchase_id: purchase.id },
      items: [
        {
          quantity: 1,
          price: {
            unit_price: { amount: '500', currency_code: 'USD' },
            tax_mode: 'internal',
            quantity: { minimum: 1, maximum: 1 },
            product: { tax_category: 'standard' },
          },
        },
      ],
    });
    expect(call?.body).not.toHaveProperty('customer_id');

    const stored = s.store.peek(purchase.id);
    expect(stored.providerTxnId).toBe(checkout.transactionId);
    expect(stored.providerData).toMatchObject({ environment: 'sandbox' });
    expect(String(stored.providerData.priceId)).toMatch(/^pri_/);
  });

  it('uses the catalog price for the environment when config/business.ts has one', async () => {
    const s = setup();
    paddlePriceIds.sandbox.creator = 'pri_sandbox_creator';
    try {
      const purchase = s.store.seed({ provider: 'paddle', packId: 'creator' });
      await paddle.createCheckout(purchase, { email: null }, s.ctx);
      expect(s.api.calls[0]?.body).toMatchObject({
        items: [{ price_id: 'pri_sandbox_creator', quantity: 1 }],
      });
      expect(s.store.peek(purchase.id).providerData.priceId).toBe('pri_sandbox_creator');
    } finally {
      paddlePriceIds.sandbox.creator = '';
    }
  });

  it('talks to the live API with live prices in production', async () => {
    const s = setup({ env: { PADDLE_ENVIRONMENT: 'production' } });
    paddlePriceIds.live.studio = 'pri_live_studio';
    try {
      const purchase = s.store.seed({ provider: 'paddle', packId: 'studio' });
      const checkout = await paddle.createCheckout(purchase, { email: null }, s.ctx);
      expect(checkout).toMatchObject({ environment: 'production' });
      expect(s.api.calls[0]?.body).toMatchObject({ items: [{ price_id: 'pri_live_studio' }] });
    } finally {
      paddlePriceIds.live.studio = '';
    }
  });

  it('finds or makes the buyer’s Paddle customer from the email', async () => {
    const s = setup();
    const first = s.store.seed({ provider: 'paddle' });
    await paddle.createCheckout(first, { email: 'buyer@example.com' }, s.ctx);
    const customerId = s.api.customers.get('buyer@example.com');
    expect(customerId).toMatch(/^ctm_/);
    expect(s.api.calls.map((call) => `${call.method} ${call.path.split('?')[0] ?? ''}`)).toEqual([
      'GET /customers',
      'POST /customers',
      'POST /transactions',
    ]);
    expect(s.api.calls[2]?.body).toMatchObject({ customer_id: customerId });

    const second = s.store.seed({ provider: 'paddle' });
    await paddle.createCheckout(second, { email: 'buyer@example.com' }, s.ctx);
    expect(s.api.calls.slice(3).map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(s.api.calls[4]?.body).toMatchObject({ customer_id: customerId });
  });

  it('carries on without a customer when Paddle won’t look one up', async () => {
    const s = setup();
    s.api.fail('GET', '/customers', 403, 'forbidden');
    const purchase = s.store.seed({ provider: 'paddle' });
    const checkout = await paddle.createCheckout(purchase, { email: 'buyer@example.com' }, s.ctx);
    expect(checkout.kind).toBe('paddle-overlay');
    expect(s.api.calls.at(-1)?.body).not.toHaveProperty('customer_id');
  });

  it('gives a returning buyer the same transaction', async () => {
    const s = setup();
    const { purchase, transactionId } = await checkedOut(s);
    const again = await paddle.createCheckout(purchase, { email: null }, s.ctx);
    expect(again).toMatchObject({ transactionId });
    expect(s.api.calls).toHaveLength(1);
  });

  it('reports Paddle’s refusal by status and code, never the key, and attaches nothing', async () => {
    const s = setup();
    s.api.fail('POST', '/transactions', 400, 'transaction_default_checkout_url_not_set');
    const purchase = s.store.seed({ provider: 'paddle' });
    const error: unknown = await paddle
      .createCheckout(purchase, { email: null }, s.ctx)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaddleApiError);
    expect(String(error)).toContain('400');
    expect(String(error)).toContain('transaction_default_checkout_url_not_set');
    expect(String(error)).not.toContain(KEY);
    expect(s.store.peek(purchase.id).providerTxnId).toBeNull();
  });

  it('refuses without its env, with a bad environment, or for a purchase it can’t take', async () => {
    const missing = setup({ env: { PADDLE_CLIENT_TOKEN: undefined } });
    const purchase = missing.store.seed({ provider: 'paddle' });
    await expect(paddle.createCheckout(purchase, { email: null }, missing.ctx)).rejects.toThrow(
      ProviderConfigError,
    );

    const wrongEnv = setup({ env: { PADDLE_ENVIRONMENT: 'live' } });
    await expect(
      paddle.createCheckout(
        wrongEnv.store.seed({ provider: 'paddle' }),
        { email: null },
        wrongEnv.ctx,
      ),
    ).rejects.toThrow(/sandbox or production/);

    const s = setup();
    await expect(
      paddle.createCheckout(s.store.seed({ provider: 'click' }), { email: null }, s.ctx),
    ).rejects.toThrow();
    await expect(
      paddle.createCheckout(
        s.store.seed({ provider: 'paddle', status: 'completed' }),
        { email: null },
        s.ctx,
      ),
    ).rejects.toThrow();
    expect(s.api.calls).toHaveLength(0);
  });

  it('declares the env it needs', () => {
    expect(paddle.requiredEnv).toEqual([
      'PADDLE_API_KEY',
      'PADDLE_WEBHOOK_SECRET',
      'PADDLE_ENVIRONMENT',
      'PADDLE_CLIENT_TOKEN',
    ]);
    expect(paddle.currency).toBe('USD');
  });
});

describe('Paddle-Signature', () => {
  const now = new Date(Date.UTC(2026, 9, 2, 9, 0, 0));
  const ts = Math.floor(now.getTime() / 1000);
  const body = '{"event_id":"evt_1"}';

  it('accepts Paddle’s HMAC of ts:body within 5 minutes either way', () => {
    expect(verifyPaddleSignature(paddleSignature(body, SECRET, ts), body, SECRET, now)).toBe(true);
    const edge = ts - SIGNATURE_TOLERANCE_SECONDS;
    expect(verifyPaddleSignature(paddleSignature(body, SECRET, edge), body, SECRET, now)).toBe(
      true,
    );
    const old = ts - SIGNATURE_TOLERANCE_SECONDS - 1;
    expect(verifyPaddleSignature(paddleSignature(body, SECRET, old), body, SECRET, now)).toBe(
      false,
    );
    const ahead = ts + SIGNATURE_TOLERANCE_SECONDS + 1;
    expect(verifyPaddleSignature(paddleSignature(body, SECRET, ahead), body, SECRET, now)).toBe(
      false,
    );
  });

  it('refuses another secret, another body, and malformed headers', () => {
    const good = paddleSignature(body, SECRET, ts);
    expect(verifyPaddleSignature(paddleSignature(body, 'other', ts), body, SECRET, now)).toBe(
      false,
    );
    expect(verifyPaddleSignature(good, `${body} `, SECRET, now)).toBe(false);
    for (const header of [
      null,
      '',
      'garbage',
      `ts=${String(ts)}`,
      good.replace(/ts=\d+/, 'ts=abc'),
      good.replace(/ts=\d+/, `ts=${String(ts + 1)}`),
    ])
      expect(verifyPaddleSignature(header, body, SECRET, now)).toBe(false);
  });

  it('accepts any of several h1 while a secret rotates', () => {
    const good = paddleSignature(body, SECRET, ts);
    const rotated = `ts=${String(ts)};h1=${'0'.repeat(64)};${good.split(';')[1] ?? ''}`;
    expect(verifyPaddleSignature(rotated, body, SECRET, now)).toBe(true);
  });
});

describe('Paddle webhooks', () => {
  it('credit a real-shaped transaction.completed once', async () => {
    const s = setup();
    const { purchase, transaction } = await checkedOut(s);
    const { response } = await deliver(s, 'transaction.completed', {
      ...transaction,
      status: 'completed',
    });
    expect(response.status).toBe(200);
    expect(s.store.peek(purchase.id)).toMatchObject({
      status: 'completed',
      providerData: { paidTotal: '500', paidCurrency: 'USD' },
    });
    expect(s.store.balance()).toBe(200);
    expect(s.store.events[0]).toMatchObject({
      provider: 'paddle',
      type: 'transaction.completed',
      processed: true,
      error: null,
    });
  });

  it('credit on transaction.paid, and find it done when transaction.completed follows', async () => {
    const s = setup();
    const { purchase, transaction } = await checkedOut(s, 'creator');
    await deliver(s, 'transaction.paid', { ...transaction, status: 'paid' });
    await deliver(s, 'transaction.completed', { ...transaction, status: 'completed' });
    expect(s.store.ledgerFor(purchase.id)).toHaveLength(1);
    expect(s.store.balance()).toBe(700);
    expect(s.store.events.map((event) => event.error)).toEqual([null, null]);
  });

  it('answer a repeated event 200 and do nothing', async () => {
    const s = setup();
    const { transaction } = await checkedOut(s);
    const event = paddleEvent('transaction.completed', { ...transaction, status: 'completed' });
    const first = await paddle.handleWebhook(
      paddleWebhook(event, SECRET, { now: s.clock.now() }),
      s.ctx,
    );
    s.clock.advance(60_000);
    const again = await paddle.handleWebhook(
      paddleWebhook(event, SECRET, { now: s.clock.now() }),
      s.ctx,
    );
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(s.store.events).toHaveLength(1);
    expect(s.store.ledger).toHaveLength(1);
  });

  it('answer 401 to a bad, missing, old or forged signature, before storing anything', async () => {
    const s = setup();
    const { transaction } = await checkedOut(s);
    const event = paddleEvent('transaction.completed', { ...transaction, status: 'completed' });
    const now = s.clock.now();
    const requests = [
      paddleWebhook(event, 'not-the-secret', { now }),
      paddleWebhook(event, SECRET, { now, signature: null }),
      paddleWebhook(event, SECRET, { now: new Date(now.getTime() - 6 * 60_000) }),
      paddleWebhook(event, SECRET, {
        now,
        signature: paddleSignature(JSON.stringify(event), SECRET, Math.floor(now.getTime() / 1000)),
        body: JSON.stringify({ ...event, event_id: 'evt_forged' }),
      }),
    ];
    for (const request of requests) {
      const response = await paddle.handleWebhook(request, s.ctx);
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
    }
    expect(s.store.events).toHaveLength(0);
    expect(s.store.ledger).toHaveLength(0);
  });

  it('answer 400 to a signed body that isn’t a Paddle event', async () => {
    const s = setup();
    const now = s.clock.now();
    for (const body of ['not json', '[]', '{"event_type":"transaction.completed","data":{}}']) {
      const response = await paddle.handleWebhook(
        paddleWebhook(null, SECRET, { now, body }),
        s.ctx,
      );
      expect(response.status).toBe(400);
    }
    expect(s.store.events).toHaveLength(0);
  });

  it('answer 200 to events they don’t act on', async () => {
    const s = setup();
    for (const type of ['customer.created', 'transaction.created', 'transaction.payment_failed']) {
      const { response } = await deliver(s, type, { id: paddleId('ctm') });
      expect(response.status).toBe(200);
    }
    expect(s.store.events.every((event) => event.processed && event.error === null)).toBe(true);
    expect(s.store.ledger).toHaveLength(0);
  });

  it('don’t credit a transaction our checkout didn’t create, even with our purchase id', async () => {
    const s = setup();
    const purchase = s.store.seed({ provider: 'paddle', packId: 'studio' });
    const forged = transactionData({ id: paddleId('txn'), purchaseId: purchase.id });
    const { response } = await deliver(s, 'transaction.completed', forged);
    expect(response.status).toBe(200);
    expect(s.store.peek(purchase.id).status).toBe('pending');
    expect(s.store.ledger).toHaveLength(0);
    expect(s.store.events[0]?.error).toMatch(/no purchase/);
  });

  it('don’t credit when the items changed after checkout', async () => {
    const s = setup();
    const quantity = await checkedOut(s);
    await deliver(s, 'transaction.completed', {
      ...transactionData({
        id: quantity.transactionId,
        purchaseId: quantity.purchase.id,
        quantity: 3,
      }),
    });
    const price = await checkedOut(s);
    await deliver(
      s,
      'transaction.completed',
      transactionData({
        id: price.transactionId,
        purchaseId: price.purchase.id,
        priceId: 'pri_cheaper',
      }),
    );
    expect(s.store.ledger).toHaveLength(0);
    expect(s.store.events.map((event) => event.error)).toEqual([
      expect.stringMatching(/quantity/),
      expect.stringMatching(/price/),
    ]);
  });

  it('don’t credit a total or currency other than the purchase’s, and keep why', async () => {
    const s = setup();
    // A discount code typed into the overlay: $4.00 paid for a $5.00 pack.
    const discounted = await checkedOut(s);
    const lower = transactionData({
      id: discounted.transactionId,
      purchaseId: discounted.purchase.id,
      priceId: String(discounted.purchase.providerData.priceId),
      grandTotal: '400',
    });
    const { response } = await deliver(s, 'transaction.completed', lower);
    expect(response.status).toBe(200);
    // The same amount in another currency.
    const euros = await checkedOut(s);
    await deliver(
      s,
      'transaction.paid',
      transactionData({
        id: euros.transactionId,
        purchaseId: euros.purchase.id,
        priceId: String(euros.purchase.providerData.priceId),
        status: 'paid',
        currency: 'EUR',
      }),
    );
    // No totals at all.
    const bare = await checkedOut(s);
    await deliver(s, 'transaction.completed', {
      ...bare.transaction,
      status: 'completed',
      details: {},
    });
    expect(s.store.ledger).toHaveLength(0);
    for (const { purchase } of [discounted, euros, bare])
      expect(s.store.peek(purchase.id).status).toBe('pending');
    expect(s.store.events.map((event) => event.error)).toEqual([
      'not credited: the transaction total is 400, not 500 (minor units)',
      'not credited: the transaction is in EUR, not USD',
      'not credited: the transaction total is missing, not 500 (minor units)',
    ]);

    // The right amount still credits.
    const exact = await checkedOut(s);
    await deliver(s, 'transaction.completed', { ...exact.transaction, status: 'completed' });
    expect(s.store.balance()).toBe(200);
  });

  it('still credit a checkout opened before Paddle was switched off, and still take refunds', async () => {
    const s = setup();
    const { purchase, transaction } = await checkedOut(s);
    const earlier = await paid(s);
    s.ctx.open = false;
    await deliver(s, 'transaction.completed', { ...transaction, status: 'completed' });
    expect(s.store.peek(purchase.id).status).toBe('completed');
    await deliver(
      s,
      'adjustment.updated',
      adjustmentData({ transactionId: earlier.transactionId, action: 'chargeback' }),
    );
    expect(s.store.peek(earlier.purchase.id).status).toBe('chargeback');
    expect(s.store.balance()).toBe(200);
    expect(s.store.events.every((event) => event.error === null)).toBe(true);
  });

  it('don’t credit a transaction that isn’t paid', async () => {
    const s = setup();
    const { transaction } = await checkedOut(s);
    await deliver(s, 'transaction.completed', { ...transaction, status: 'billed' });
    expect(s.store.ledger).toHaveLength(0);
  });

  it('flag money that arrives for a cancelled purchase', async () => {
    const s = setup();
    const { purchase, transaction } = await checkedOut(s);
    await s.store.cancel(purchase.id);
    const { response } = await deliver(s, 'transaction.completed', {
      ...transaction,
      status: 'completed',
    });
    expect(response.status).toBe(200);
    expect(s.store.ledger).toHaveLength(0);
    expect(s.store.events[0]?.error).toMatch(/cancelled/);
  });

  it('take the credits back when a refund is approved, not before, and only once', async () => {
    const s = setup();
    const { purchase, transactionId } = await paid(s);
    const adjustment = adjustmentData({ transactionId, status: 'pending_approval' });
    await deliver(s, 'adjustment.created', adjustment);
    expect(s.store.balance()).toBe(200);
    await deliver(s, 'adjustment.updated', { ...adjustment, status: 'rejected' });
    expect(s.store.balance()).toBe(200);
    await deliver(s, 'adjustment.updated', { ...adjustment, status: 'approved' });
    await deliver(s, 'adjustment.updated', { ...adjustment, status: 'approved' });
    expect(s.store.peek(purchase.id).status).toBe('refunded');
    expect(s.store.balance()).toBe(0);
    expect(s.store.ledgerFor(purchase.id).map((row) => row.credits)).toEqual([200, -200]);
    expect(s.store.peek(purchase.id).providerData.adjustmentIds).toEqual([adjustment.id]);
    expect(s.store.events.every((event) => event.error === null)).toBe(true);
  });

  it('take back a share of the credits for a partial refund, then the rest', async () => {
    const s = setup();
    const { purchase, transactionId } = await paid(s);
    await deliver(
      s,
      'adjustment.created',
      adjustmentData({ transactionId, type: 'partial', total: '125' }),
    );
    expect(s.store.peek(purchase.id).status).toBe('partially_refunded');
    expect(s.store.balance()).toBe(150);
    await deliver(
      s,
      'adjustment.created',
      adjustmentData({ transactionId, type: 'partial', total: '375' }),
    );
    expect(s.store.peek(purchase.id).status).toBe('refunded');
    expect(s.store.balance()).toBe(0);
  });

  it('take at least one credit for a tiny partial refund', async () => {
    const s = setup();
    const { transactionId } = await paid(s);
    await deliver(
      s,
      'adjustment.created',
      adjustmentData({ transactionId, type: 'partial', total: '1' }),
    );
    expect(s.store.balance()).toBe(199);
  });

  it('size a partial refund from Paddle’s API when the paid total wasn’t kept', async () => {
    const s = setup();
    const { purchase, transactionId } = await checkedOut(s);
    await s.store.complete(purchase.id);
    await deliver(
      s,
      'adjustment.created',
      adjustmentData({ transactionId, type: 'partial', total: '250' }),
    );
    expect(s.api.calls.at(-1)).toMatchObject({
      method: 'GET',
      path: `/transactions/${transactionId}`,
    });
    expect(s.store.balance()).toBe(100);
  });

  it('mark chargebacks, which may leave the balance below zero', async () => {
    const s = setup();
    const { purchase, transactionId } = await paid(s);
    s.store.ledger.push({
      userId: 'user-1',
      purchaseId: 'jobs',
      kind: 'purchase',
      credits: -120,
      refundId: null,
      at: new Date(),
    });
    await deliver(s, 'adjustment.created', adjustmentData({ transactionId, action: 'chargeback' }));
    expect(s.store.peek(purchase.id).status).toBe('chargeback');
    expect(s.store.balance()).toBe(-120);
  });

  it('flag a reversed chargeback for a human, and ignore warnings and credits', async () => {
    const s = setup();
    const { transactionId } = await paid(s);
    await deliver(
      s,
      'adjustment.created',
      adjustmentData({ transactionId, action: 'chargeback_warning' }),
    );
    await deliver(s, 'adjustment.created', adjustmentData({ transactionId, action: 'credit' }));
    await deliver(
      s,
      'adjustment.created',
      adjustmentData({ transactionId, action: 'chargeback_reverse' }),
    );
    expect(s.store.balance()).toBe(200);
    expect(s.store.events.slice(-3).map((event) => event.error)).toEqual([
      null,
      null,
      expect.stringMatching(/by hand/),
    ]);
  });

  it('answer 500 and keep the error when the store fails, so the event shows in admin', async () => {
    class BrokenStore extends MemoryPurchaseStore {
      override complete(): Promise<PurchaseRecord> {
        return Promise.reject(new Error('database is down'));
      }
    }
    const s = setup({ store: new BrokenStore() });
    const { transaction } = await checkedOut(s);
    const { response } = await deliver(s, 'transaction.completed', {
      ...transaction,
      status: 'completed',
    });
    expect(response.status).toBe(500);
    expect(s.store.events[0]).toMatchObject({ processed: true, error: 'Error: database is down' });
  });

  it('answer 503 while the webhook secret is unset', async () => {
    const s = setup({ env: { PADDLE_WEBHOOK_SECRET: undefined } });
    const response = await paddle.handleWebhook(
      paddleWebhook(paddleEvent('transaction.completed', {}), SECRET),
      s.ctx,
    );
    expect(response.status).toBe(503);
  });
});

describe('Paddle refunds', () => {
  it('ask Paddle for a full refund; the credits go when the approval arrives', async () => {
    const s = setup();
    const { purchase, transactionId } = await paid(s);
    if (!paddle.refund) throw new Error('Paddle refunds through its API');
    await paddle.refund(purchase, s.ctx);

    expect(s.api.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/adjustments',
      body: { action: 'refund', transaction_id: transactionId, type: 'full' },
    });
    const requested = s.store.peek(purchase.id);
    expect(requested.status).toBe('completed');
    expect(String(requested.providerData.refundRequestId)).toMatch(/^adj_/);
    expect(s.store.balance()).toBe(200);

    await deliver(
      s,
      'adjustment.updated',
      adjustmentData({ id: String(requested.providerData.refundRequestId), transactionId }),
    );
    expect(s.store.balance()).toBe(0);
  });

  it('refuse a purchase that isn’t completed', async () => {
    const s = setup();
    const { purchase } = await checkedOut(s);
    if (!paddle.refund) throw new Error('Paddle refunds through its API');
    await expect(paddle.refund(purchase, s.ctx)).rejects.toThrow();
    expect(s.api.calls).toHaveLength(1);
  });
});
