/**
 * Paddle's real sandbox, end to end (docs/05 → Payments). Runs only with
 * PADDLE_SANDBOX_API_KEY set (.github/workflows/paddle-sandbox.yml), and is
 * skipped everywhere else.
 *
 * 1. createCheckout makes a real sandbox transaction for a pending purchase.
 * 2. That transaction, read back from the API, goes through handleWebhook as
 *    a signed transaction.completed, and the purchase gets its credits.
 *
 * The logs are public: assertions compare shapes and booleans, never print
 * keys, and a failed API call reports only its HTTP status and Paddle's code.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { paddle, PADDLE_API } from './paddle';
import { paddleEvent, paddleId, paddleWebhook } from './sim/paddle';
import { Clock, testContext } from './testing/context';
import { MemoryPurchaseStore } from './testing/memory-store';

const apiKey = process.env.PADDLE_SANDBOX_API_KEY ?? '';
// Signing needs a secret, not Paddle's: the webhook test signs its own payload.
const webhookSecret = process.env.PADDLE_SANDBOX_WEBHOOK_SECRET || 'pdl_ntfset_sandbox_test_secret';

function sandbox() {
  const store = new MemoryPurchaseStore();
  const ctx = testContext({
    store,
    // Real time: the webhook below is signed with the real clock.
    clock: new Clock(Date.now()),
    env: {
      PADDLE_API_KEY: apiKey,
      PADDLE_WEBHOOK_SECRET: webhookSecret,
      PADDLE_ENVIRONMENT: 'sandbox',
      PADDLE_CLIENT_TOKEN: 'test_sandbox_client_token',
    },
    fetch: (input, init) => fetch(input, init),
  });
  return { store, ctx };
}

describe.skipIf(apiKey === '')('Paddle sandbox (live API)', () => {
  it('creates a real transaction for a pending purchase and opens the overlay', async () => {
    const { store, ctx } = sandbox();
    const purchase = store.seed({ provider: 'paddle', packId: 'starter' });
    const checkout = await paddle.createCheckout(
      purchase,
      { email: `etb-sandbox-${randomUUID().slice(0, 8)}@example.com` },
      ctx,
    );

    expect(checkout.kind).toBe('paddle-overlay');
    if (checkout.kind !== 'paddle-overlay') return;
    expect(checkout.environment).toBe('sandbox');
    expect(/^txn_[a-z0-9]+$/.test(checkout.transactionId)).toBe(true);
    expect(store.peek(purchase.id).providerTxnId === checkout.transactionId).toBe(true);
  }, 30_000);

  it('credits the purchase from a signed transaction.completed built from that transaction', async () => {
    const { store, ctx } = sandbox();
    const purchase = store.seed({ provider: 'paddle', packId: 'creator' });
    const checkout = await paddle.createCheckout(purchase, { email: null }, ctx);
    if (checkout.kind !== 'paddle-overlay') throw new Error('Expected the overlay');

    const response = await fetch(`${PADDLE_API.sandbox}/transactions/${checkout.transactionId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Paddle-Version': '1' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: Record<string, unknown> };
    const transaction = body.data;
    if (!transaction) throw new Error('Paddle returned no transaction');
    expect(transaction.id === checkout.transactionId).toBe(true);
    expect(
      (transaction.custom_data as { purchase_id?: string } | null)?.purchase_id === purchase.id,
    ).toBe(true);

    const event = paddleEvent(
      'transaction.completed',
      { ...transaction, status: 'completed' },
      paddleId('evt'),
    );
    const answer = await paddle.handleWebhook(paddleWebhook(event, webhookSecret), ctx);
    expect(answer.status).toBe(200);
    expect(store.peek(purchase.id).status).toBe('completed');
    expect(store.balance()).toBe(700);
    expect(store.events[0]?.error ?? null).toBeNull();
  }, 30_000);
});
