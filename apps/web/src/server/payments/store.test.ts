/**
 * The PurchaseStore on a real Postgres (TEST_DATABASE_URL; skipped without it).
 */
import { randomUUID } from 'node:crypto';

import {
  and,
  creditTransactions,
  eq,
  ledgerMismatches,
  purchases,
  webhookEvents,
  type Db,
} from '@etb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { balanceOf, newPurchase, newUser, openTestDb, TEST_DATABASE_URL } from '../test-db';
import type { PurchaseStore } from './contract';
import { createPurchaseStore, PurchaseError } from './store';

describe.skipIf(!TEST_DATABASE_URL)('PurchaseStore', () => {
  let db: Db;
  let close: () => Promise<void>;
  let store: PurchaseStore;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    store = createPurchaseStore(db);
  });

  afterAll(async () => {
    await close();
  });

  const rowsFor = (purchaseId: string) =>
    db.select().from(creditTransactions).where(eq(creditTransactions.purchaseId, purchaseId));

  async function code(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof PurchaseError) return error.code;
      throw error;
    }
    return undefined;
  }

  it('reads a purchase by id and by the provider’s transaction', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId, { provider: 'click' });
    const record = await store.get(id);
    expect(record).toMatchObject({
      id,
      userId,
      provider: 'click',
      packId: 'creator',
      credits: 700,
      amountMinor: 1500,
      currency: 'USD',
      status: 'pending',
      providerTxnId: null,
      providerData: {},
    });
    expect(record?.createdAt).toBeInstanceOf(Date);
    expect(await store.get(randomUUID())).toBeNull();
    // Whatever a provider passes as an order id: never an error.
    expect(await store.get('not-a-uuid')).toBeNull();
    expect(await store.get("1' or 1=1 --")).toBeNull();

    const txn = String(Date.now());
    await store.attach(id, txn, { prepareId: 7 });
    expect(await store.byProviderTxn('click', txn)).toMatchObject({ id, providerTxnId: txn });
    expect(await store.byProviderTxn('payme', txn)).toBeNull();
  });

  it('attaches a transaction once, and merges data', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId, { provider: 'payme' });
    const txn = randomUUID().replace(/-/g, '').slice(0, 24);
    await store.attach(id, txn, { createTime: 1, state: 1 });
    const again = await store.attach(id, txn, { state: 1, reason: null });
    expect(again.providerData).toEqual({ createTime: 1, state: 1, reason: null });
    expect(await code(store.attach(id, 'another'))).toBe('TXN_MISMATCH');
    const other = await newPurchase(db, userId, { provider: 'payme' });
    expect(await code(store.attach(other, txn))).toBe('TXN_TAKEN');
    expect(await code(store.attach(randomUUID(), 'x'))).toBe('NOT_FOUND');
    const updated = await store.updateData(id, { state: 2, nested: { a: 1 } });
    expect(updated.status).toBe('pending');
    expect(updated.providerData).toEqual({
      createTime: 1,
      state: 2,
      reason: null,
      nested: { a: 1 },
    });
  });

  it('completes once: one ledger row, whatever the repeats', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    const done = await store.complete(id, { paidAt: 'now' });
    expect(done.status).toBe('completed');
    expect(done.providerData).toEqual({ paidAt: 'now' });
    expect(await balanceOf(db, userId)).toBe(700);
    const again = await store.complete(id, { paidAt: 'later' });
    expect(again.providerData).toEqual({ paidAt: 'now' });
    const rows = await rowsFor(id);
    expect(rows.map((r) => [r.kind, r.amount, r.balanceAfter])).toEqual([['purchase', 700, 700]]);
  });

  it('completes once under concurrent webhooks', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => store.complete(id)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await rowsFor(id)).toHaveLength(1);
    expect(await balanceOf(db, userId)).toBe(700);
  });

  it('cancels a pending purchase without a ledger row, and never a completed one', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    expect((await store.cancel(id, { reason: 3 })).status).toBe('cancelled');
    expect((await store.cancel(id)).status).toBe('cancelled');
    expect(await code(store.complete(id))).toBe('WRONG_STATE');
    expect(await rowsFor(id)).toHaveLength(0);
    const paid = await newPurchase(db, userId);
    await store.complete(paid);
    expect(await code(store.cancel(paid))).toBe('WRONG_STATE');
  });

  it('refunds all credits, once per refund id, even below zero', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    await store.complete(id);
    // Some credits spent: the refund takes the balance below zero.
    const { applyCredit } = await import('@etb/db');
    await applyCredit(db, userId, 'reserve', -500, { jobId: randomUUID() });
    expect(await code(store.refund(randomUUID(), { refundId: 'r' }))).toBe('NOT_FOUND');
    const refunded = await store.refund(id, { refundId: 'adj_1' }, { adjustment: 'adj_1' });
    expect(refunded.status).toBe('refunded');
    expect(await balanceOf(db, userId)).toBe(-500);
    const again = await store.refund(id, { refundId: 'adj_1' });
    expect(again.status).toBe('refunded');
    expect(await store.refund(id, { refundId: 'adj_2' })).toMatchObject({ status: 'refunded' });
    const refunds = await db
      .select()
      .from(creditTransactions)
      .where(
        and(eq(creditTransactions.purchaseId, id), eq(creditTransactions.kind, 'refund_purchase')),
      );
    expect(refunds.map((r) => [r.amount, r.reason])).toEqual([[-700, 'adj_1']]);
    expect(await code(store.complete(id))).toBe('WRONG_STATE');
    expect((await ledgerMismatches(db)).filter((m) => m.userId === userId)).toEqual([]);
  });

  it('refunds part, then the rest, and never more than was bought', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    await store.complete(id);
    const part = await store.refund(id, { refundId: 'p1', credits: 200 });
    expect(part.status).toBe('partially_refunded');
    expect(await balanceOf(db, userId)).toBe(500);
    expect(await code(store.refund(id, { refundId: 'p2', credits: 501 }))).toBe('BAD_REFUND');
    expect(await code(store.refund(id, { refundId: 'p2', credits: 0 }))).toBe('BAD_REFUND');
    expect(await code(store.refund(id, { refundId: ' ' }))).toBe('BAD_REFUND');
    const rest = await store.refund(id, { refundId: 'p2' });
    expect(rest.status).toBe('refunded');
    expect(await balanceOf(db, userId)).toBe(0);
  });

  it('marks a chargeback, with the credits taken back', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    await store.complete(id);
    const charged = await store.refund(id, { refundId: 'cb_1', chargeback: true });
    expect(charged.status).toBe('chargeback');
    expect(await balanceOf(db, userId)).toBe(0);
    // A later refund event for the same money adds nothing and keeps the flag.
    expect((await store.refund(id, { refundId: 'adj_9' })).status).toBe('chargeback');
    expect(await rowsFor(id)).toHaveLength(2);
  });

  it('refuses to refund what was never paid', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    expect(await code(store.refund(id, { refundId: 'x' }))).toBe('WRONG_STATE');
    await store.cancel(id);
    expect(await code(store.refund(id, { refundId: 'x' }))).toBe('WRONG_STATE');
  });

  it('lists a provider’s purchases in a time window, oldest first', async () => {
    const userId = await newUser(db);
    const from = new Date(Date.now() - 1000);
    const a = await newPurchase(db, userId, { provider: 'payme' });
    const b = await newPurchase(db, userId, { provider: 'payme' });
    await newPurchase(db, userId, { provider: 'click' });
    const to = new Date(Date.now() + 1000);
    const listed = (await store.list('payme', from, to)).filter((p) => p.userId === userId);
    expect(listed.map((p) => p.id)).toEqual([a, b]);
    const early = await store.list('payme', new Date(0), new Date(1000));
    expect(early).toEqual([]);
    const [row] = await db.select().from(purchases).where(eq(purchases.id, a));
    expect(row?.provider).toBe('payme');
  });

  it('stores each webhook once and marks it processed', async () => {
    const eventId = `evt_${randomUUID()}`;
    const first = await store.recordEvent('paddle', eventId, 'transaction.completed', { a: 1 });
    expect(first.fresh).toBe(true);
    const again = await store.recordEvent('paddle', eventId, 'transaction.completed', { a: 2 });
    expect(again).toEqual({ id: first.id, fresh: false });
    // The same id from another provider is another event.
    expect((await store.recordEvent('click', eventId, 'complete', 'raw')).fresh).toBe(true);
    await store.markEventProcessed(first.id, 'boom');
    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, first.id));
    expect(row?.payload).toEqual({ a: 1 });
    expect(row?.error).toBe('boom');
    expect(row?.processedAt).toBeInstanceOf(Date);
    await store.markEventProcessed(first.id);
    const [cleared] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, first.id));
    expect(cleared?.error).toBeNull();
  });
});
