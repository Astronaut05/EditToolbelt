/**
 * The Click provider against the Click simulator: every documented call and
 * every answer code, as Click would play them.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { PurchaseRecord } from '../../contract';
import { click, CLICK_ERRORS } from '../click';
import { Clock, testContext } from '../testing/context';
import { MemoryPurchaseStore } from '../testing/memory-store';
import { ClickSimulator } from './click';

const ENV = {
  CLICK_SERVICE_ID: '12345',
  CLICK_MERCHANT_ID: '67890',
  CLICK_MERCHANT_USER_ID: '24680',
  CLICK_SECRET_KEY: 's3cr3t-key',
};
const STARTER = '63000.00';

function setup(store?: MemoryPurchaseStore) {
  const clock = new Clock();
  const db = store ?? new MemoryPurchaseStore(clock.now);
  const ctx = testContext({ store: db, env: ENV, clock });
  const sim = new ClickSimulator({
    serviceId: ENV.CLICK_SERVICE_ID,
    secretKey: ENV.CLICK_SECRET_KEY,
    send: (request) => click.handleWebhook(request, ctx),
    now: clock.now,
  });
  const purchase = db.seed({ provider: 'click', packId: 'starter' });
  return { clock, store: db, sim, purchase };
}

describe('Click, played by the simulator', () => {
  it('Prepare then Complete credits the purchase once (0)', async () => {
    const { store, sim, purchase } = setup();
    const { prepare, complete, clickTransId } = await sim.pay(purchase.id, STARTER);

    expect(prepare.status).toBe(200);
    expect(prepare.answer).toEqual({
      click_trans_id: Number(clickTransId),
      merchant_trans_id: purchase.id,
      merchant_prepare_id: expect.any(Number) as number,
      error: 0,
      error_note: 'Success',
    });
    expect(complete?.answer).toEqual({
      click_trans_id: Number(clickTransId),
      merchant_trans_id: purchase.id,
      merchant_confirm_id: prepare.answer.merchant_prepare_id,
      error: 0,
      error_note: 'Success',
    });
    const stored = store.peek(purchase.id);
    expect(stored).toMatchObject({ status: 'completed', providerTxnId: clickTransId });
    expect(stored.providerData).toMatchObject({
      clickTransId,
      prepareId: prepare.answer.merchant_prepare_id,
    });
    expect(store.balance()).toBe(200);
  });

  it('accepts the amount written without decimals', async () => {
    const { store, sim, purchase } = setup();
    const { complete } = await sim.pay(purchase.id, '63000');
    expect(complete?.answer.error).toBe(0);
    expect(store.balance()).toBe(200);
  });

  it('answers a repeated Prepare with the same prepare id', async () => {
    const { sim, purchase } = setup();
    const clickTransId = sim.newTransId();
    const first = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
    });
    const again = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
    });
    expect(again.answer).toEqual(first.answer);
  });

  it('answers a repeated Complete with success again and adds no second ledger row', async () => {
    const { store, sim, purchase } = setup();
    const { prepare, complete, clickTransId } = await sim.pay(purchase.id, STARTER);
    const again = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
      merchantPrepareId: prepare.answer.merchant_prepare_id,
    });
    expect(again.answer).toEqual(complete?.answer);
    expect(store.ledgerFor(purchase.id)).toHaveLength(1);
  });

  it('refuses a bad signature (-1): another secret, or a field changed after signing', async () => {
    const { store, sim, purchase } = setup();
    const forged = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      secretKey: 'guessed',
    });
    const tampered = await sim.prepare({
      merchantTransId: purchase.id,
      amount: '1.00',
      overrides: { amount: STARTER },
    });
    const honest = await sim.prepare({ merchantTransId: purchase.id, amount: STARTER });
    expect(forged.answer).toMatchObject({ error: -1, error_note: 'SIGN CHECK FAILED!' });
    expect(tampered.answer.error).toBe(CLICK_ERRORS.SIGN_CHECK_FAILED);
    expect(honest.answer.error).toBe(0);

    const prepareId = honest.answer.merchant_prepare_id;
    const swapped = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: honest.sent.click_trans_id,
      merchantPrepareId: prepareId,
      overrides: { merchant_prepare_id: '1' },
    });
    expect(swapped.answer.error).toBe(CLICK_ERRORS.SIGN_CHECK_FAILED);
    expect(store.peek(purchase.id).status).toBe('pending');
  });

  it('refuses the wrong amount (-2) on Prepare and on Complete', async () => {
    const { store, sim, purchase } = setup();
    const low = await sim.prepare({ merchantTransId: purchase.id, amount: '62999.99' });
    expect(low.answer).toMatchObject({ error: -2, error_note: 'Incorrect parameter amount' });
    const clickTransId = sim.newTransId();
    const prepare = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
    });
    const complete = await sim.complete({
      merchantTransId: purchase.id,
      amount: '6300.00',
      clickTransId,
      merchantPrepareId: prepare.answer.merchant_prepare_id,
    });
    expect(complete.answer.error).toBe(CLICK_ERRORS.INCORRECT_AMOUNT);
    expect(store.peek(purchase.id).status).toBe('pending');
  });

  it('answers an unknown action with -3', async () => {
    const { sim, purchase } = setup();
    const answer = await sim.send('2', { merchantTransId: purchase.id, amount: STARTER });
    expect(answer.answer).toMatchObject({ error: -3, error_note: 'Action not found' });
  });

  it('answers -4 to a Prepare for a paid order, and to a second payment’s Complete', async () => {
    const { store, sim, purchase } = setup();
    const first = sim.newTransId();
    const second = sim.newTransId();
    const prepareFirst = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: first,
    });
    const prepareSecond = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: second,
    });
    const completeSecond = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: second,
      merchantPrepareId: prepareSecond.answer.merchant_prepare_id,
    });
    expect(completeSecond.answer.error).toBe(0);

    // The older attempt can't complete the order a second time.
    const completeFirst = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: first,
      merchantPrepareId: prepareFirst.answer.merchant_prepare_id,
    });
    expect(completeFirst.answer).toMatchObject({ error: -4, error_note: 'Already paid' });
    const prepareAgain = await sim.prepare({ merchantTransId: purchase.id, amount: STARTER });
    expect(prepareAgain.answer.error).toBe(CLICK_ERRORS.ALREADY_PAID);
    expect(store.ledgerFor(purchase.id)).toHaveLength(1);
  });

  it('answers -5 to an order we don’t have, or another provider’s', async () => {
    const { store, sim } = setup();
    const unknown = await sim.prepare({ merchantTransId: randomUUID(), amount: STARTER });
    expect(unknown.answer).toMatchObject({ error: -5, error_note: 'User does not exist' });
    const payme = store.seed({ provider: 'payme' });
    const other = await sim.prepare({ merchantTransId: payme.id, amount: STARTER });
    expect(other.answer.error).toBe(CLICK_ERRORS.ORDER_NOT_FOUND);
  });

  it('answers -6 to a Complete without its Prepare, or with another prepare id', async () => {
    const { store, sim, purchase } = setup();
    const never = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: sim.newTransId(),
      merchantPrepareId: 123,
    });
    expect(never.answer).toMatchObject({ error: -6, error_note: 'Transaction does not exist' });

    const clickTransId = sim.newTransId();
    const prepare = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
    });
    const wrongId = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
      merchantPrepareId: Number(prepare.answer.merchant_prepare_id) + 1,
    });
    expect(wrongId.answer.error).toBe(CLICK_ERRORS.TRANSACTION_NOT_FOUND);
    expect(store.peek(purchase.id).status).toBe('pending');
  });

  it('lets the latest Prepare win: an abandoned attempt’s Complete gets -6', async () => {
    const { store, sim, purchase } = setup();
    const old = sim.newTransId();
    const oldPrepare = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: old,
    });
    const retry = await sim.pay(purchase.id, STARTER);
    expect(retry.complete?.answer.error).toBe(0);
    const late = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: old,
      merchantPrepareId: oldPrepare.answer.merchant_prepare_id,
      error: -5017,
    });
    expect(late.answer.error).toBe(CLICK_ERRORS.ALREADY_PAID);
    expect(store.peek(purchase.id).status).toBe('completed');
    expect(store.balance()).toBe(200);
  });

  it('answers -7 when the purchase can’t be updated', async () => {
    class BrokenStore extends MemoryPurchaseStore {
      override complete(): Promise<PurchaseRecord> {
        return Promise.reject(new Error('database is down'));
      }
    }
    const { sim, purchase } = setup(new BrokenStore());
    const { complete } = await sim.pay(purchase.id, STARTER);
    expect(complete?.answer).toMatchObject({ error: -7, error_note: 'Failed to update user' });
  });

  it('answers -8 to a request missing fields, with malformed ones, or for another service', async () => {
    const { store, sim, purchase } = setup();
    const noSign = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      omit: ['sign_string'],
    });
    const noOrder = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      omit: ['merchant_trans_id'],
    });
    const noPrepareId = await sim.complete({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: sim.newTransId(),
      omit: ['merchant_prepare_id'],
    });
    const notNumber = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId: 'abc',
    });
    for (const exchange of [noSign, noOrder, noPrepareId, notNumber]) {
      expect(exchange.status).toBe(200);
      expect(exchange.answer).toMatchObject({
        error: -8,
        error_note: 'Error in request from click',
      });
    }

    const otherService = new ClickSimulator({
      serviceId: '99999',
      secretKey: ENV.CLICK_SECRET_KEY,
      send: (request) => click.handleWebhook(request, testContext({ store, env: ENV })),
    });
    const wrongService = await otherService.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
    });
    expect(wrongService.answer.error).toBe(CLICK_ERRORS.BAD_REQUEST);
    expect(store.peek(purchase.id).providerData).toEqual({});
  });

  it('cancels on Click’s own error (-9), and answers -9 to anything after', async () => {
    const { store, sim, purchase } = setup();
    const clickTransId = sim.newTransId();
    const prepare = await sim.prepare({
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
    });
    const failed = {
      merchantTransId: purchase.id,
      amount: STARTER,
      clickTransId,
      merchantPrepareId: prepare.answer.merchant_prepare_id,
      error: -5017,
      errorNote: 'Insufficient funds',
    };
    const cancelled = await sim.complete(failed);
    expect(cancelled.answer).toMatchObject({ error: -9, error_note: 'Transaction cancelled' });
    expect(store.peek(purchase.id)).toMatchObject({
      status: 'cancelled',
      providerData: { clickError: -5017 },
    });

    // Repeats, a successful Complete after the cancel, and a new Prepare all get -9.
    expect((await sim.complete(failed)).answer.error).toBe(CLICK_ERRORS.TRANSACTION_CANCELLED);
    const afterCancel = await sim.complete({ ...failed, error: 0 });
    expect(afterCancel.answer.error).toBe(CLICK_ERRORS.TRANSACTION_CANCELLED);
    const prepareAgain = await sim.prepare({ merchantTransId: purchase.id, amount: STARTER });
    expect(prepareAgain.answer.error).toBe(CLICK_ERRORS.TRANSACTION_CANCELLED);
    expect(store.ledger).toHaveLength(0);
  });
});
