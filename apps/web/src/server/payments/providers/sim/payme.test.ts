/**
 * The Payme provider against the Payme simulator: a payment's whole life,
 * repeats of every call, timeouts, and every error code Payme can get.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { fiscalReceipt } from '@etb/config/business';

import type { PurchaseRecord } from '../../contract';
import {
  payme,
  PAYME_ERRORS,
  PAYME_ORDER_MAX_AGE_MS,
  PAYME_REASON_TIMEOUT,
  PAYME_STATE,
  PAYME_TIMEOUT_MS,
} from '../payme';
import { Clock, testContext } from '../testing/context';
import { MemoryPurchaseStore } from '../testing/memory-store';
import { paymeAuthorization, paymeId, PaymeSimulator } from './payme';

const ENV = {
  PAYME_MERCHANT_ID: '587f72c72cac0d162c722ae2',
  PAYME_KEY: 'payme-merchant-key',
  PAYME_TEST: 'true',
};
const STARTER = 6_300_000;
const HOUR = 60 * 60 * 1000;

function setup(store?: MemoryPurchaseStore, clock = new Clock()) {
  const db = store ?? new MemoryPurchaseStore(clock.now);
  const ctx = testContext({ store: db, env: ENV, clock });
  const sim = new PaymeSimulator({
    key: ENV.PAYME_KEY,
    send: (request) => payme.handleWebhook(request, ctx),
    now: clock.now,
  });
  const purchase = db.seed({ provider: 'payme', packId: 'starter' });
  return { clock, store: db, sim, purchase, now: () => clock.now().getTime() };
}

describe('Payme, played by the simulator', () => {
  it('pays an order: check, create, perform; credits once', async () => {
    const { store, sim, purchase, now } = setup();
    const { paymeId: id, check, create, perform } = await sim.pay(purchase.id, STARTER);

    expect(check.status).toBe(200);
    expect(check.result).toEqual({
      allow: true,
      detail: {
        receipt_type: 0,
        items: [
          {
            title: 'EditToolbelt credits: 200',
            price: STARTER,
            count: 1,
            code: fiscalReceipt.mxik,
            package_code: fiscalReceipt.packageCode,
            vat_percent: fiscalReceipt.vatPercent,
          },
        ],
      },
    });
    expect(create.result).toEqual({ create_time: now(), transaction: purchase.id, state: 1 });
    expect(perform.result).toEqual({ transaction: purchase.id, perform_time: now(), state: 2 });

    expect(store.peek(purchase.id)).toMatchObject({
      status: 'completed',
      providerTxnId: id,
      providerData: {
        state: 2,
        time: now(),
        create_time: now(),
        perform_time: now(),
        cancel_time: 0,
        reason: null,
      },
    });
    expect(store.balance()).toBe(200);
  });

  it('keeps every authenticated call with the answer it got', async () => {
    const { store, sim, purchase } = setup();
    await sim.checkPerform(purchase.id, STARTER, { authorization: paymeAuthorization('wrong') });
    expect(store.events).toEqual([]);

    await sim.checkPerform(purchase.id, 1);
    const { paymeId: id } = await sim.pay(purchase.id, STARTER);
    await sim.statement(0, 1);
    await sim.call('ChangePassword', { password: 'a-new-merchant-key' });
    expect(
      store.events.map((event) => [event.eventId, event.type, event.answer, event.error]),
    ).toEqual([
      // The refused check, then the one that passed: one row, the latest answer.
      [`CheckPerformTransaction:${purchase.id}`, 'CheckPerformTransaction', 'result', null],
      [`CreateTransaction:${id}`, 'CreateTransaction', 'result', null],
      [`PerformTransaction:${id}`, 'PerformTransaction', 'result', null],
      ['GetStatement:0-1', 'GetStatement', 'result', null],
      ['ChangePassword:', 'ChangePassword', '-32601 Method not found', null],
    ]);
    expect(store.events[1]?.payload).toMatchObject({
      method: 'CreateTransaction',
      params: { id, amount: STARTER, account: { order_id: purchase.id } },
    });
    // A method we don't have keeps no params: ChangePassword's carry a new key.
    expect(JSON.stringify(store.events[4]?.payload)).not.toContain('a-new-merchant-key');

    const wrong = await sim.create(store.seed({ provider: 'payme' }).id, 1);
    expect(wrong.error?.code).toBe(PAYME_ERRORS.WRONG_AMOUNT);
    expect(store.events.at(-1)).toMatchObject({
      type: 'CreateTransaction',
      answer: '-31001 Wrong amount',
      error: null,
    });
  });

  it('answers repeats of every call the same way, with no second ledger row', async () => {
    const { store, sim, clock, purchase } = setup();
    const create = await sim.create(purchase.id, STARTER);
    clock.advance(5_000);
    const createAgain = await sim.create(purchase.id, STARTER, {
      id: create.paymeId,
      time: Number(create.result?.create_time),
    });
    expect(createAgain.result).toEqual(create.result);

    const perform = await sim.perform(create.paymeId);
    clock.advance(5_000);
    expect((await sim.perform(create.paymeId)).result).toEqual(perform.result);
    expect(store.ledgerFor(purchase.id)).toHaveLength(1);

    const check = await sim.check(create.paymeId);
    expect((await sim.check(create.paymeId)).result).toEqual(check.result);

    const cancel = await sim.cancel(create.paymeId, 5);
    clock.advance(5_000);
    expect((await sim.cancel(create.paymeId, 5)).result).toEqual(cancel.result);
    expect(store.ledgerFor(purchase.id)).toHaveLength(2);
  });

  it('answers concurrent Performs and Cancels with the times it kept', async () => {
    // Each store write takes a second, so calls that overlap see different clocks.
    const clock = new Clock();
    class SlowStore extends MemoryPurchaseStore {
      override complete(id: string, data?: Record<string, unknown>): Promise<PurchaseRecord> {
        clock.advance(1_000);
        return super.complete(id, data);
      }
      override refund(
        id: string,
        opts: { refundId: string },
        data?: Record<string, unknown>,
      ): Promise<PurchaseRecord> {
        clock.advance(1_000);
        return super.refund(id, opts, data);
      }
    }
    const { store, sim, purchase } = setup(new SlowStore(clock.now), clock);
    const create = await sim.create(purchase.id, STARTER);
    const performs = await Promise.all([sim.perform(create.paymeId), sim.perform(create.paymeId)]);
    const kept = store.peek(purchase.id).providerData.perform_time;
    expect(performs.map((answer) => answer.result?.perform_time)).toEqual([kept, kept]);
    expect(store.ledgerFor(purchase.id)).toHaveLength(1);

    const cancels = await Promise.all([
      sim.cancel(create.paymeId, 5),
      sim.cancel(create.paymeId, 5),
    ]);
    const cancelTime = store.peek(purchase.id).providerData.cancel_time;
    expect(cancels.map((answer) => answer.result)).toEqual([
      { transaction: purchase.id, cancel_time: cancelTime, state: -2 },
      { transaction: purchase.id, cancel_time: cancelTime, state: -2 },
    ]);
    expect(store.ledgerFor(purchase.id).map((row) => row.credits)).toEqual([200, -200]);
  });

  it('settles a Perform racing a Cancel as if one came after the other', async () => {
    const { store, sim, purchase } = setup();
    const create = await sim.create(purchase.id, STARTER);
    // Both read state 1; the Perform writes first, so the Cancel refunds it.
    const [perform, cancel] = await Promise.all([
      sim.perform(create.paymeId),
      sim.cancel(create.paymeId, 5),
    ]);
    expect(perform.result).toMatchObject({ state: 2 });
    expect(cancel.result).toMatchObject({ state: -2 });
    expect(store.peek(purchase.id)).toMatchObject({
      status: 'refunded',
      providerData: { state: -2, reason: 5 },
    });
    expect(store.ledgerFor(purchase.id).map((row) => row.credits)).toEqual([200, -200]);
    expect((await sim.check(create.paymeId)).result).toMatchObject({ state: -2 });
  });

  it('cancels before perform: state -1, the order is cancelled and can’t be performed', async () => {
    const { store, sim, clock, purchase, now } = setup();
    const create = await sim.create(purchase.id, STARTER);
    clock.advance(60_000);
    const cancel = await sim.cancel(create.paymeId, 3);
    expect(cancel.result).toEqual({ transaction: purchase.id, cancel_time: now(), state: -1 });
    expect(store.peek(purchase.id).status).toBe('cancelled');

    const perform = await sim.perform(create.paymeId);
    expect(perform.error?.code).toBe(PAYME_ERRORS.CANNOT_PERFORM);
    const check = await sim.check(create.paymeId);
    expect(check.result).toMatchObject({
      state: -1,
      reason: 3,
      cancel_time: now(),
      perform_time: 0,
    });
    expect((await sim.checkPerform(purchase.id, STARTER)).error?.code).toBe(
      PAYME_ERRORS.ORDER_NOT_PAYABLE,
    );
    expect(store.ledger).toHaveLength(0);
  });

  it('cancels after perform: state -2, the credits go back even below zero', async () => {
    const { store, sim, clock, purchase, now } = setup();
    const { paymeId: id } = await sim.pay(purchase.id, STARTER);
    store.ledger.push({
      userId: 'user-1',
      purchaseId: 'jobs',
      kind: 'purchase',
      credits: -150,
      refundId: null,
      at: new Date(),
    });
    clock.advance(HOUR);
    const cancel = await sim.cancel(id, 5);
    expect(cancel.result).toEqual({ transaction: purchase.id, cancel_time: now(), state: -2 });
    expect(store.peek(purchase.id)).toMatchObject({
      status: 'refunded',
      providerData: { state: -2, reason: 5, cancel_time: now() },
    });
    expect(store.balance()).toBe(-150);
    expect((await sim.perform(id)).error?.code).toBe(PAYME_ERRORS.CANNOT_PERFORM);
  });

  it('refuses to cancel a performed transaction whose purchase was already refunded elsewhere (-31007)', async () => {
    const { store, sim, purchase } = setup();
    const { paymeId: id } = await sim.pay(purchase.id, STARTER);
    await store.refund(purchase.id, { refundId: 'admin' });
    const cancel = await sim.cancel(id, 5);
    expect(cancel.error?.code).toBe(PAYME_ERRORS.CANNOT_CANCEL);
    expect(store.events.at(-1)?.error).toMatch(/refunded purchase: check it by hand/);
    expect(store.ledgerFor(purchase.id)).toHaveLength(2);
  });

  it('times out a transaction not performed in 12 hours: reason 4, then -31008', async () => {
    const { store, sim, clock, purchase, now } = setup();
    const create = await sim.create(purchase.id, STARTER);
    clock.advance(PAYME_TIMEOUT_MS + 1);
    const perform = await sim.perform(create.paymeId);
    expect(perform.error?.code).toBe(PAYME_ERRORS.CANNOT_PERFORM);
    expect(store.peek(purchase.id).status).toBe('cancelled');
    const check = await sim.check(create.paymeId);
    expect(check.result).toMatchObject({
      state: -1,
      reason: PAYME_REASON_TIMEOUT,
      cancel_time: now(),
    });
    expect(store.ledger).toHaveLength(0);
  });

  it('times out on a repeated CreateTransaction too', async () => {
    const { store, sim, clock, purchase } = setup();
    const create = await sim.create(purchase.id, STARTER);
    clock.advance(PAYME_TIMEOUT_MS + 1);
    const again = await sim.create(purchase.id, STARTER, {
      id: create.paymeId,
      time: Number(create.result?.create_time),
    });
    expect(again.error?.code).toBe(PAYME_ERRORS.CANNOT_PERFORM);
    expect(store.peek(purchase.id).providerData).toMatchObject({ state: -1, reason: 4 });
  });

  it('refuses a transaction Payme created more than 12 hours ago (-31008)', async () => {
    const { store, sim, purchase, now } = setup();
    const create = await sim.create(purchase.id, STARTER, { time: now() - PAYME_TIMEOUT_MS - 1 });
    expect(create.error).toMatchObject({ code: PAYME_ERRORS.CANNOT_PERFORM, data: 'time' });
    expect(store.peek(purchase.id).providerTxnId).toBeNull();
  });

  it('keeps one active transaction per order (-31052), and frees the order when it times out', async () => {
    const { store, sim, clock, purchase } = setup();
    const first = await sim.create(purchase.id, STARTER);
    const second = await sim.create(purchase.id, STARTER);
    expect(second.error).toMatchObject({ code: PAYME_ERRORS.ORDER_BUSY, data: 'order_id' });
    expect(second.error?.message).toEqual({
      ru: expect.any(String) as string,
      uz: expect.any(String) as string,
      en: 'The order is being paid in another transaction',
    });
    clock.advance(PAYME_TIMEOUT_MS + 1);
    const third = await sim.create(purchase.id, STARTER);
    expect(third.error?.code).toBe(PAYME_ERRORS.ORDER_NOT_PAYABLE);
    expect(store.peek(purchase.id)).toMatchObject({
      status: 'cancelled',
      providerTxnId: first.paymeId,
    });
  });

  it('refuses the wrong amount (-31001) on check and create', async () => {
    const { sim, purchase } = setup();
    const check = await sim.checkPerform(purchase.id, STARTER - 100);
    expect(check.error).toMatchObject({ code: -31001, data: 'amount' });
    expect(check.error?.message.ru).toBe('Неверная сумма');
    const create = await sim.create(purchase.id, STARTER + 100);
    expect(create.error?.code).toBe(PAYME_ERRORS.WRONG_AMOUNT);
  });

  it('refuses an order we don’t have, or another provider’s (-31050)', async () => {
    const { store, sim } = setup();
    expect((await sim.checkPerform(randomUUID(), STARTER)).error).toMatchObject({
      code: -31050,
      data: 'order_id',
    });
    expect((await sim.create(randomUUID(), STARTER)).error?.code).toBe(
      PAYME_ERRORS.ORDER_NOT_FOUND,
    );
    const click = store.seed({ provider: 'click' });
    expect((await sim.checkPerform(click.id, STARTER)).error?.code).toBe(
      PAYME_ERRORS.ORDER_NOT_FOUND,
    );
    const noAccount = await sim.call('CheckPerformTransaction', { amount: STARTER, account: {} });
    expect(noAccount.error?.code).toBe(PAYME_ERRORS.ORDER_NOT_FOUND);
  });

  it('refuses a paid, cancelled or week-old order (-31051)', async () => {
    const { store, sim, clock, purchase } = setup();
    await sim.pay(purchase.id, STARTER);
    expect((await sim.checkPerform(purchase.id, STARTER)).error?.code).toBe(
      PAYME_ERRORS.ORDER_NOT_PAYABLE,
    );
    const cancelled = store.seed({ provider: 'payme' });
    await store.cancel(cancelled.id);
    expect((await sim.checkPerform(cancelled.id, STARTER)).error?.code).toBe(
      PAYME_ERRORS.ORDER_NOT_PAYABLE,
    );
    const old = store.seed({ provider: 'payme' });
    clock.advance(PAYME_ORDER_MAX_AGE_MS + 1);
    expect((await sim.create(old.id, STARTER)).error?.code).toBe(PAYME_ERRORS.ORDER_NOT_PAYABLE);
  });

  it('answers -31003 for a transaction we don’t have', async () => {
    const { sim } = setup();
    const id = paymeId();
    for (const answer of [await sim.perform(id), await sim.cancel(id, 1), await sim.check(id)])
      expect(answer.error?.code).toBe(PAYME_ERRORS.TRANSACTION_NOT_FOUND);
  });

  it('refuses wrong credentials with -32504 before reading the body', async () => {
    const { store, sim, purchase } = setup();
    for (const authorization of [
      null,
      paymeAuthorization('wrong-key'),
      paymeAuthorization(ENV.PAYME_KEY, 'Admin'),
      `Bearer ${ENV.PAYME_KEY}`,
      'Basic !!!',
    ]) {
      const answer = await sim.checkPerform(purchase.id, STARTER, { authorization });
      expect(answer.status).toBe(200);
      expect(answer.error?.code).toBe(PAYME_ERRORS.AUTH);
      // The body was never parsed, so its id is unknown.
      expect(answer.id).toBeNull();
    }
    // Not even a body that isn't JSON gets further than the credentials.
    const garbage = await sim.call(
      'CheckTransaction',
      {},
      { rawBody: '{not json', authorization: paymeAuthorization('wrong-key') },
    );
    expect(garbage).toMatchObject({ id: null, error: { code: PAYME_ERRORS.AUTH } });
    expect(store.events).toEqual([]);
    const create = await sim.call(
      'CreateTransaction',
      { id: paymeId(), time: Date.now(), amount: STARTER, account: { order_id: purchase.id } },
      { authorization: paymeAuthorization('wrong-key') },
    );
    expect(create.error?.code).toBe(PAYME_ERRORS.AUTH);
    expect(store.peek(purchase.id).providerTxnId).toBeNull();
  });

  it('answers JSON-RPC errors: parse (-32700), invalid (-32600), unknown method (-32601), not POST (-32300)', async () => {
    const { sim } = setup();
    const parse = await sim.call('CheckTransaction', {}, { rawBody: '{not json' });
    expect(parse).toMatchObject({ status: 200, id: null, error: { code: -32700 } });
    const noParams = await sim.call(
      'CheckTransaction',
      {},
      { rawBody: '{"id":7,"method":"CheckTransaction"}' },
    );
    expect(noParams).toMatchObject({ id: 7, error: { code: -32600 } });
    const badAmount = await sim.call('CheckPerformTransaction', { amount: '6300000', account: {} });
    expect(badAmount.error?.code).toBe(PAYME_ERRORS.INVALID_REQUEST);
    const badId = await sim.call('PerformTransaction', { id: 42 });
    expect(badId.error?.code).toBe(PAYME_ERRORS.INVALID_REQUEST);
    const unknown = await sim.call('ChangePassword', { password: 'new' });
    expect(unknown.error).toMatchObject({ code: -32601, data: 'ChangePassword' });
    const notPost = await sim.call('CheckTransaction', {}, { httpMethod: 'GET' });
    expect(notPost.error?.code).toBe(PAYME_ERRORS.NOT_POST);
  });

  it('answers -32400 when the store fails, without the reason', async () => {
    class BrokenStore extends MemoryPurchaseStore {
      override complete(): Promise<PurchaseRecord> {
        return Promise.reject(new Error('database is down'));
      }
    }
    const { store, sim, purchase } = setup(new BrokenStore());
    const { perform } = await sim.pay(purchase.id, STARTER);
    expect(perform.error).toMatchObject({ code: PAYME_ERRORS.SYSTEM_ERROR });
    expect(perform.error).not.toHaveProperty('data');
    // The reason is the event's error, which alerts.
    expect(store.events.at(-1)).toMatchObject({
      type: 'PerformTransaction',
      answer: '-32400 System error',
      error: 'Error: database is down',
    });
  });

  it('lists transactions by Payme’s time for GetStatement, oldest first, with their states', async () => {
    const { store, sim, clock, purchase, now } = setup();
    const start = now();
    // Made two days before it's paid: still in the statement for the day it was paid.
    clock.advance(48 * HOUR);
    const paid = await sim.pay(purchase.id, STARTER);
    clock.advance(HOUR);
    const second = store.seed({ provider: 'payme', packId: 'creator' });
    const cancelled = await sim.create(second.id, 18_900_000);
    await sim.cancel(cancelled.paymeId, 3);
    clock.advance(HOUR);
    const third = store.seed({ provider: 'payme' });
    const later = await sim.create(third.id, STARTER);
    store.seed({ provider: 'payme' }); // never paid: not a Payme transaction

    const statement = await sim.statement(start + 48 * HOUR, start + 49 * HOUR);
    expect(statement.result).toEqual({
      transactions: [
        {
          id: paid.paymeId,
          time: start + 48 * HOUR,
          amount: STARTER,
          account: { order_id: purchase.id },
          create_time: start + 48 * HOUR,
          perform_time: start + 48 * HOUR,
          cancel_time: 0,
          transaction: purchase.id,
          state: PAYME_STATE.PERFORMED,
          reason: null,
          receivers: null,
        },
        expect.objectContaining({
          id: cancelled.paymeId,
          time: start + 49 * HOUR,
          amount: 18_900_000,
          state: PAYME_STATE.CANCELLED,
          reason: 3,
        }) as unknown,
      ],
    });
    const all = await sim.statement(start, start + 60 * HOUR);
    const ids = (all.result?.transactions as { id: string }[]).map((item) => item.id);
    expect(ids).toEqual([paid.paymeId, cancelled.paymeId, later.paymeId]);
    expect((await sim.statement(start, start + HOUR)).result).toEqual({ transactions: [] });
  });
});
