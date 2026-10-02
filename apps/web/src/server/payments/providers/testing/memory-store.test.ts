import { describe, expect, it } from 'vitest';

import { MemoryPurchaseStore } from './memory-store';

describe('MemoryPurchaseStore (the contract fake)', () => {
  it('seeds pending purchases priced from config, USD in cents and UZS in tiyin', () => {
    const store = new MemoryPurchaseStore();
    const paddle = store.seed({ provider: 'paddle', packId: 'creator' });
    const click = store.seed({ provider: 'click', packId: 'studio' });
    expect(paddle).toMatchObject({ status: 'pending', currency: 'USD', amountMinor: 1500 });
    expect(paddle.credits).toBe(700);
    expect(click).toMatchObject({ currency: 'UZS', amountMinor: 49_900_000, credits: 2000 });
  });

  it('attaches a provider transaction once; the same id again only merges data', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'paddle' });
    await store.attach(purchase.id, 'txn_1', { a: 1 });
    const again = await store.attach(purchase.id, 'txn_1', { b: 2 });
    expect(again.providerTxnId).toBe('txn_1');
    expect(again.providerData).toEqual({ a: 1, b: 2 });
    await expect(store.attach(purchase.id, 'txn_2')).rejects.toThrow();
    expect((await store.byProviderTxn('paddle', 'txn_1'))?.id).toBe(purchase.id);
    expect(await store.byProviderTxn('click', 'txn_1')).toBeNull();
  });

  it('never gives one provider transaction to two purchases', async () => {
    const store = new MemoryPurchaseStore();
    const first = store.seed({ provider: 'payme' });
    const second = store.seed({ provider: 'payme' });
    await store.attach(first.id, 'p-1');
    await expect(store.attach(second.id, 'p-1')).rejects.toThrow();
    expect(store.peek(second.id).providerTxnId).toBeNull();
  });

  it('completes once, with one purchase ledger row', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'click' });
    await store.complete(purchase.id, { x: 1 });
    const again = await store.complete(purchase.id, { x: 2 });
    expect(again.status).toBe('completed');
    expect(again.providerData).toEqual({ x: 1 });
    expect(store.ledgerFor(purchase.id)).toHaveLength(1);
    expect(store.balance()).toBe(200);
  });

  it('cancels a pending purchase without a ledger row, idempotently; completed refuses', async () => {
    const store = new MemoryPurchaseStore();
    const pending = store.seed({ provider: 'click' });
    await store.cancel(pending.id);
    expect((await store.cancel(pending.id)).status).toBe('cancelled');
    await expect(store.complete(pending.id)).rejects.toThrow();
    const paid = store.seed({ provider: 'click' });
    await store.complete(paid.id);
    await expect(store.cancel(paid.id)).rejects.toThrow();
    expect(store.ledger).toHaveLength(1);
  });

  it('refunds per refundId: partial, then the rest, then nothing more', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'paddle' });
    await expect(store.refund(purchase.id, { refundId: 'r0' })).rejects.toThrow();
    await store.complete(purchase.id);
    const partial = await store.refund(purchase.id, { refundId: 'r1', credits: 50 });
    expect(partial.status).toBe('partially_refunded');
    await store.refund(purchase.id, { refundId: 'r1', credits: 50 });
    expect(store.balance()).toBe(150);
    const rest = await store.refund(purchase.id, { refundId: 'r2' });
    expect(rest.status).toBe('refunded');
    expect(store.balance()).toBe(0);
    await expect(store.refund(purchase.id, { refundId: 'r3' })).rejects.toThrow();
    expect(store.ledgerFor(purchase.id).map((row) => row.credits)).toEqual([200, -50, -150]);
  });

  it('lets a refund take the balance below zero, and marks chargebacks', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'paddle' });
    await store.complete(purchase.id);
    store.ledger.push({
      userId: 'user-1',
      purchaseId: 'job',
      kind: 'purchase',
      credits: -180,
      refundId: null,
      at: new Date(),
    });
    const charged = await store.refund(purchase.id, { refundId: 'cb', chargeback: true });
    expect(charged.status).toBe('chargeback');
    expect(store.balance()).toBe(-180);
  });

  it('rolls a failed change back completely', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'paddle' });
    await expect(
      store.refund(purchase.id, { refundId: 'r', credits: 5 }, { touched: true }),
    ).rejects.toThrow();
    expect(store.peek(purchase.id).providerData).toEqual({});
  });

  it('hands out copies, as a database would', async () => {
    const store = new MemoryPurchaseStore();
    const purchase = store.seed({ provider: 'paddle' });
    const read = await store.get(purchase.id);
    if (!read) throw new Error('missing');
    read.status = 'completed';
    read.providerData.x = 1;
    expect(store.peek(purchase.id)).toMatchObject({ status: 'pending', providerData: {} });
  });

  it('records each (provider, event id) once, fresh again until processed without an error', async () => {
    const store = new MemoryPurchaseStore();
    const first = await store.recordEvent('paddle', 'evt_1', 'transaction.completed', { a: 1 });
    const other = await store.recordEvent('click', 'evt_1', 'prepare', {});
    expect(first.fresh).toBe(true);
    expect(other.fresh).toBe(true);
    // Never marked (the process died): the retry is fresh.
    expect(await store.recordEvent('paddle', 'evt_1', 'transaction.completed', {})).toEqual({
      id: first.id,
      fresh: true,
    });
    await store.markEventProcessed(first.id, 'why', '-7 Failed to update user');
    expect(store.events[0]).toMatchObject({
      processed: true,
      error: 'why',
      answer: '-7 Failed to update user',
    });
    // Failed: the retry is fresh again.
    expect((await store.recordEvent('paddle', 'evt_1', 'transaction.completed', {})).fresh).toBe(
      true,
    );
    await store.markEventProcessed(first.id);
    expect(await store.recordEvent('paddle', 'evt_1', 'transaction.completed', {})).toEqual({
      id: first.id,
      fresh: false,
    });
    expect(store.events).toHaveLength(2);
    expect(store.events[0]).toMatchObject({ payload: { a: 1 }, error: null, answer: null });
  });

  it('lists a provider’s purchases in a time range, oldest first', async () => {
    const store = new MemoryPurchaseStore();
    const t = Date.UTC(2026, 9, 1);
    const late = store.seed({ provider: 'payme', createdAt: new Date(t + 2000) });
    const early = store.seed({ provider: 'payme', createdAt: new Date(t + 1000) });
    store.seed({ provider: 'payme', createdAt: new Date(t + 5000) });
    store.seed({ provider: 'click', createdAt: new Date(t + 1500) });
    const found = await store.list('payme', new Date(t), new Date(t + 3000));
    expect(found.map((purchase) => purchase.id)).toEqual([early.id, late.id]);
  });
});
