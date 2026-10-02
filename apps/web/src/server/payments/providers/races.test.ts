/**
 * Click and Payme against the database store (TEST_DATABASE_URL; skipped
 * without it), where calls really overlap: row locks, the unique indexes and
 * the ledger decide, not the order the test wrote them in. Whatever wins, the
 * answers, the purchase and the ledger must agree.
 */
import { and, creditTransactions, eq, webhookEvents, type Db } from '@etb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { balanceOf, newPurchase, newUser, openTestDb, TEST_DATABASE_URL } from '../../test-db';
import type { ProviderContext, PurchaseRecord, PurchaseStore } from '../contract';
import { createPurchaseStore } from '../store';
import { click, CLICK_ERRORS } from './click';
import { payme, PAYME_ERRORS, PAYME_STATE } from './payme';
import { ClickSimulator } from './sim/click';
import { PaymeSimulator } from './sim/payme';
import { testContext } from './testing/context';

const CLICK_ENV = {
  CLICK_SERVICE_ID: '12345',
  CLICK_MERCHANT_ID: '67890',
  CLICK_MERCHANT_USER_ID: '24680',
  CLICK_SECRET_KEY: 's3cr3t-key',
};
const PAYME_ENV = {
  PAYME_MERCHANT_ID: '587f72c72cac0d162c722ae2',
  PAYME_KEY: 'payme-merchant-key',
  PAYME_TEST: 'true',
};
const STARTER_SUMS = '63000.00';
const STARTER_TIYIN = 6_300_000;

/** A clock that moves a second each time it's read, so overlapping calls see different times. */
function ticking(): () => Date {
  let ms = Date.now();
  return () => {
    ms += 1000;
    return new Date(ms);
  };
}

describe.skipIf(!TEST_DATABASE_URL)('Click and Payme on the database', () => {
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

  const ledger = async (purchaseId: string) =>
    (
      await db
        .select({ amount: creditTransactions.amount })
        .from(creditTransactions)
        .where(eq(creditTransactions.purchaseId, purchaseId))
        .orderBy(creditTransactions.createdAt)
    ).map((row) => row.amount);

  async function starter(provider: 'click' | 'payme') {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId, {
      provider,
      packId: 'starter',
      credits: 200,
      amountMinor: STARTER_TIYIN,
      currency: 'UZS',
    });
    return { userId, id };
  }

  function context(env: Record<string, string>, over: Partial<ProviderContext> = {}) {
    const now = ticking();
    return { ...testContext({ store, env }), now, ...over };
  }

  describe('Click', () => {
    function clickSim(ctx: ProviderContext) {
      return new ClickSimulator({
        serviceId: CLICK_ENV.CLICK_SERVICE_ID,
        secretKey: CLICK_ENV.CLICK_SECRET_KEY,
        send: (request) => click.handleWebhook(request, ctx),
      });
    }

    it('credits once when Click sends the same Complete several times at once', async () => {
      const ctx = context(CLICK_ENV);
      const sim = clickSim(ctx);
      const { userId, id } = await starter('click');
      const clickTransId = sim.newTransId();
      const prepare = await sim.prepare({
        merchantTransId: id,
        amount: STARTER_SUMS,
        clickTransId,
      });
      const completes = await Promise.all(
        Array.from({ length: 6 }, () =>
          sim.complete({
            merchantTransId: id,
            amount: STARTER_SUMS,
            clickTransId,
            merchantPrepareId: prepare.answer.merchant_prepare_id,
          }),
        ),
      );
      for (const complete of completes)
        expect(complete.answer).toMatchObject({
          error: 0,
          merchant_confirm_id: prepare.answer.merchant_prepare_id,
        });
      expect(await store.get(id)).toMatchObject({
        status: 'completed',
        providerTxnId: clickTransId,
      });
      expect(await ledger(id)).toEqual([200]);
      expect(await balanceOf(db, userId)).toBe(200);
      // Every call is kept, once per Click transaction and action.
      const events = await db
        .select()
        .from(webhookEvents)
        .where(
          and(eq(webhookEvents.provider, 'click'), eq(webhookEvents.eventId, `${clickTransId}:1`)),
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'complete', answer: '0 Success', error: null });
    });

    it('lets only the latest attempt pay when two Completes race', async () => {
      const ctx = context(CLICK_ENV);
      const sim = clickSim(ctx);
      const { id } = await starter('click');
      const [first, second] = [sim.newTransId(), sim.newTransId()];
      const prepareFirst = await sim.prepare({
        merchantTransId: id,
        amount: STARTER_SUMS,
        clickTransId: first,
      });
      const prepareSecond = await sim.prepare({
        merchantTransId: id,
        amount: STARTER_SUMS,
        clickTransId: second,
      });
      const [a, b] = await Promise.all([
        sim.complete({
          merchantTransId: id,
          amount: STARTER_SUMS,
          clickTransId: first,
          merchantPrepareId: prepareFirst.answer.merchant_prepare_id,
        }),
        sim.complete({
          merchantTransId: id,
          amount: STARTER_SUMS,
          clickTransId: second,
          merchantPrepareId: prepareSecond.answer.merchant_prepare_id,
        }),
      ]);
      expect(b.answer.error).toBe(0);
      expect([CLICK_ERRORS.TRANSACTION_NOT_FOUND, CLICK_ERRORS.ALREADY_PAID]).toContain(
        a.answer.error,
      );
      expect((await store.get(id))?.providerTxnId).toBe(second);
      expect(await ledger(id)).toEqual([200]);
    });

    it('pays a retry after a failed Complete, and answers its repeated Complete with 0', async () => {
      // The review's case, on the database: Complete A fails, Click reverses
      // A, the buyer pays again as B, Click re-sends Complete B.
      let failed = false;
      const flaky: PurchaseStore = {
        ...store,
        complete: (purchaseId, data, providerTxnId) => {
          if (!failed) {
            failed = true;
            return Promise.reject(new Error('connection reset'));
          }
          return store.complete(purchaseId, data, providerTxnId);
        },
      };
      const ctx = context(CLICK_ENV, { store: flaky });
      const sim = clickSim(ctx);
      const { userId, id } = await starter('click');
      const first = await sim.pay(id, STARTER_SUMS);
      expect(first.complete?.answer.error).toBe(CLICK_ERRORS.FAILED_TO_UPDATE);
      expect(await store.get(id)).toMatchObject({ status: 'pending', providerTxnId: null });

      const retry = await sim.pay(id, STARTER_SUMS);
      expect(retry.complete?.answer.error).toBe(0);
      const resent = await sim.complete({
        merchantTransId: id,
        amount: STARTER_SUMS,
        clickTransId: retry.clickTransId,
        merchantPrepareId: retry.prepare.answer.merchant_prepare_id,
      });
      expect(resent.answer).toEqual(retry.complete?.answer);
      expect((await store.get(id))?.providerTxnId).toBe(retry.clickTransId);
      expect(await balanceOf(db, userId)).toBe(200);
      // The failure is the first Complete's error, which alerts.
      const [failedEvent] = await db
        .select()
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.provider, 'click'),
            eq(webhookEvents.eventId, `${first.clickTransId}:1`),
          ),
        );
      expect(failedEvent).toMatchObject({
        error: 'Error: connection reset',
        answer: '-7 Failed to update user',
      });
    });

    it('replaces a stale transaction id on the purchase with the one that pays', async () => {
      const ctx = context(CLICK_ENV);
      const sim = clickSim(ctx);
      const { id } = await starter('click');
      await store.attach(id, sim.newTransId());
      const { complete, clickTransId } = await sim.pay(id, STARTER_SUMS);
      expect(complete?.answer.error).toBe(0);
      expect((await store.get(id))?.providerTxnId).toBe(clickTransId);
    });
  });

  describe('Payme', () => {
    function paymeSim(ctx: ProviderContext) {
      return new PaymeSimulator({
        key: PAYME_ENV.PAYME_KEY,
        send: (request) => payme.handleWebhook(request, ctx),
        now: () => new Date(),
      });
    }

    it('settles a Perform racing a Cancel as if one came after the other', async () => {
      const ctx = context(PAYME_ENV);
      const sim = paymeSim(ctx);
      const seen = new Set<string>();
      for (let round = 0; round < 8; round += 1) {
        const { userId, id } = await starter('payme');
        const create = await sim.create(id, STARTER_TIYIN);
        expect(create.result).toMatchObject({ state: PAYME_STATE.CREATED });
        const [perform, cancel] = await Promise.all([
          sim.perform(create.paymeId),
          sim.cancel(create.paymeId, 5),
        ]);
        const record = (await store.get(id)) as PurchaseRecord;
        const kept = record.providerData;
        expect(perform.error?.code).not.toBe(PAYME_ERRORS.SYSTEM_ERROR);
        expect(cancel.error).toBeUndefined();
        if (perform.error) {
          // Cancel first: the transaction is cancelled and never paid.
          seen.add('cancel first');
          expect(perform.error.code).toBe(PAYME_ERRORS.CANNOT_PERFORM);
          expect(cancel.result).toEqual({
            transaction: id,
            cancel_time: kept.cancel_time,
            state: PAYME_STATE.CANCELLED,
          });
          expect(record.status).toBe('cancelled');
          expect(await ledger(id)).toEqual([]);
        } else {
          // Perform first: paid, then cancelled after perform, credits back.
          seen.add('perform first');
          expect(perform.result).toEqual({
            transaction: id,
            perform_time: kept.perform_time,
            state: PAYME_STATE.PERFORMED,
          });
          expect(cancel.result).toEqual({
            transaction: id,
            cancel_time: kept.cancel_time,
            state: PAYME_STATE.CANCELLED_AFTER_PERFORM,
          });
          expect(record.status).toBe('refunded');
          expect(await ledger(id)).toEqual([200, -200]);
        }
        expect(await balanceOf(db, userId)).toBe(0);
        // Payme's own check sees what the answers said.
        expect((await sim.check(create.paymeId)).result).toMatchObject({ state: kept.state });
      }
      // Which one wins is up to the database; both outcomes are checked when they happen.
      expect(seen.size).toBeGreaterThan(0);
    });

    it('answers Performs sent at once with the one perform_time it kept', async () => {
      const ctx = context(PAYME_ENV);
      const sim = paymeSim(ctx);
      const { userId, id } = await starter('payme');
      const create = await sim.create(id, STARTER_TIYIN);
      const performs = await Promise.all(
        Array.from({ length: 5 }, () => sim.perform(create.paymeId)),
      );
      const kept = (await store.get(id))?.providerData.perform_time;
      expect(performs.map((answer) => answer.result?.perform_time)).toEqual(
        Array.from({ length: 5 }, () => kept),
      );
      expect(await ledger(id)).toEqual([200]);
      expect(await balanceOf(db, userId)).toBe(200);
      // Cancels sent at once after it: one refund, one cancel_time.
      const cancels = await Promise.all(
        Array.from({ length: 4 }, () => sim.cancel(create.paymeId, 5)),
      );
      const cancelTime = (await store.get(id))?.providerData.cancel_time;
      for (const cancel of cancels)
        expect(cancel.result).toEqual({
          transaction: id,
          cancel_time: cancelTime,
          state: PAYME_STATE.CANCELLED_AFTER_PERFORM,
        });
      expect(await ledger(id)).toEqual([200, -200]);
    });

    it('keeps one transaction per order when two CreateTransactions race', async () => {
      const ctx = context(PAYME_ENV);
      const sim = paymeSim(ctx);
      const { id } = await starter('payme');
      const [a, b] = await Promise.all([
        sim.create(id, STARTER_TIYIN),
        sim.create(id, STARTER_TIYIN),
      ]);
      const answers = [a, b];
      expect(answers.filter((answer) => answer.result)).toHaveLength(1);
      expect(
        answers.filter((answer) => answer.error?.code === PAYME_ERRORS.ORDER_BUSY),
      ).toHaveLength(1);
      const winner = answers.find((answer) => answer.result);
      expect((await store.get(id))?.providerTxnId).toBe(winner?.paymeId);
    });
  });
});
