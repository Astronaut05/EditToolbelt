/**
 * Refunds from Admin → Payments on a real Postgres (TEST_DATABASE_URL;
 * skipped without it): Paddle through its API (a fake of it), full or
 * partial, while switched off; Click recorded by hand, in proportion, once
 * per form, never past what was paid.
 */
import { randomUUID } from 'node:crypto';

import { adminAuditLog, and, applyCredit, creditTransactions, eq, type Db } from '@etb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { balanceOf, newPurchase, newUser, openTestDb, TEST_DATABASE_URL } from '../test-db';
import type { ProviderContext } from './contract';
import { click } from './providers/click';
import { paddle } from './providers/paddle';
import { payme } from './providers/payme';
import { adjustmentData, FakePaddleApi, paddleEvent, paddleWebhook } from './providers/sim/paddle';
import { Clock, testContext } from './providers/testing/context';
import { CabinetRefundForm, recordCabinetRefund, RefundForm, requestRefund } from './refunds';
import { createPurchaseStore } from './store';
import type { PaymentEnv } from './switches';

const SECRET = 'pdl_ntfset_refunds_test_secret';
const KEY = 'pdl_sdbx_apikey_refunds_test';
const PADDLE_VARS = {
  PADDLE_API_KEY: KEY,
  PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_ENVIRONMENT: 'sandbox',
  PADDLE_CLIENT_TOKEN: 'test_client_token',
};

describe('the refund forms', () => {
  const form = { purchaseId: randomUUID(), reason: 'Unused credits' };

  it('read money as people type it, in minor units', () => {
    for (const [amount, minor] of [
      ['3.75', 375],
      ['15', 1500],
      ['47250', 4_725_000],
      ['47 250', 4_725_000],
      ['47 250.50', 4_725_050],
      [' 0.01 ', 1],
    ] as const)
      expect(RefundForm.parse({ ...form, amount }).amount).toBe(minor);
  });

  it('refuse an amount that isn’t one, a short reason, or a Click form without its id', () => {
    for (const amount of ['', '0', '0.00', '3,75', '-1', '1.234', 'all', '1e3']) {
      const result = RefundForm.safeParse({ ...form, amount });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'Give the amount refunded, like 3.75 or 47250.',
      );
    }
    expect(RefundForm.safeParse({ ...form, amount: '1', reason: 'x' }).success).toBe(false);
    expect(RefundForm.safeParse({ ...form, amount: '1', purchaseId: 'nope' }).success).toBe(false);
    expect(CabinetRefundForm.safeParse({ ...form, amount: '1' }).success).toBe(false);
    expect(
      CabinetRefundForm.safeParse({ ...form, amount: '1', refundId: randomUUID() }).success,
    ).toBe(true);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('refunds from the admin', () => {
  let db: Db;
  let close: () => Promise<void>;
  let admin: string;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    admin = await newUser(db);
  });

  afterAll(async () => {
    await close();
  });

  const audited = (purchaseId: string) =>
    db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.adminId, admin), eq(adminAuditLog.targetId, purchaseId)));

  const refundRows = async (purchaseId: string) =>
    (
      await db
        .select({ amount: creditTransactions.amount })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.purchaseId, purchaseId),
            eq(creditTransactions.kind, 'refund_purchase'),
          ),
        )
        // Oldest first: without an order Postgres may return them either way.
        .orderBy(creditTransactions.createdAt, creditTransactions.id)
    ).map((row) => row.amount);

  describe('Paddle, through its API', () => {
    // Switched off (PAYMENTS_ENABLED false), keys set: refunds still work.
    const env = (vars: Record<string, string> = PADDLE_VARS): PaymentEnv => ({
      enabled: false,
      vars,
      providers: [paddle, click, payme],
      fiscal: { mxik: '1', packageCode: '2', tin: '301234567', pinfl: '' },
      unfinished: {},
    });

    function setup() {
      const api = new FakePaddleApi(KEY);
      const clock = new Clock(Date.now());
      const ctx = testContext({
        store: createPurchaseStore(db),
        env: PADDLE_VARS,
        fetch: api.fetch,
        clock,
      });
      const context = (open: boolean): ProviderContext => ({ ...ctx, open });
      const deliver = async (type: string, data: Record<string, unknown>) => {
        const response = await paddle.handleWebhook(
          paddleWebhook(paddleEvent(type, data), SECRET, { now: clock.now() }),
          ctx,
        );
        expect(response.status).toBe(200);
      };
      return { api, ctx, context, deliver };
    }

    /** A Creator pack ($15.00, 700 credits) bought through Paddle's checkout and webhook. */
    async function bought(s: ReturnType<typeof setup>) {
      const userId = await newUser(db);
      const id = await newPurchase(db, userId);
      const record = await createPurchaseStore(db).get(id);
      if (!record) throw new Error('no purchase');
      const checkout = await paddle.createCheckout(record, { email: null }, s.ctx);
      if (checkout.kind !== 'paddle-overlay') throw new Error('expected the overlay');
      const transaction = s.api.transactions.get(checkout.transactionId) ?? {};
      await s.deliver('transaction.completed', { ...transaction, status: 'completed' });
      expect(await balanceOf(db, userId)).toBe(700);
      return { userId, id, transactionId: checkout.transactionId };
    }

    it('asks for part of a purchase; the credits come off in proportion when Paddle approves', async () => {
      const s = setup();
      const { userId, id, transactionId } = await bought(s);
      // 100 of 700 credits used: $12.86 back for the 600 unused.
      const result = await requestRefund(
        db,
        { adminId: admin, purchaseId: id, amountMinor: 1286, reason: 'Unused credits' },
        env(),
        s.context,
      );
      expect(result).toEqual({ ok: true, status: 'completed' });
      expect(s.api.calls.at(-1)?.body).toMatchObject({
        type: 'partial',
        items: [{ amount: '1286' }],
      });
      // Nothing comes off until Paddle approves.
      expect(await balanceOf(db, userId)).toBe(700);
      expect((await audited(id)).map((row) => [row.action, row.after, row.reason])).toEqual([
        ['purchase.refund', { requested_minor: 1286, currency: 'USD' }, 'Unused credits'],
      ]);

      await s.deliver(
        'adjustment.updated',
        adjustmentData({ transactionId, type: 'partial', total: '1286' }),
      );
      expect(await balanceOf(db, userId)).toBe(100);
      expect(await refundRows(id)).toEqual([-600]);
      expect((await createPurchaseStore(db).get(id))?.status).toBe('partially_refunded');
    });

    it('asks for a full refund for the whole payment', async () => {
      const s = setup();
      const { id } = await bought(s);
      const result = await requestRefund(
        db,
        { adminId: admin, purchaseId: id, amountMinor: 1500, reason: 'Asked within 14 days' },
        env(),
        s.context,
      );
      expect(result.ok).toBe(true);
      expect(s.api.calls.at(-1)?.body).toMatchObject({ type: 'full' });
    });

    it('refuses what it can’t do, and audits nothing then', async () => {
      const s = setup();
      const { id } = await bought(s);
      const ask = (
        purchaseId: string,
        amountMinor: number,
        vars: Record<string, string> = PADDLE_VARS,
      ) =>
        requestRefund(
          db,
          { adminId: admin, purchaseId, amountMinor, reason: 'Testing refusals' },
          env(vars),
          s.context,
        );
      expect(await ask(id, 1501)).toEqual({
        ok: false,
        reason: 'That’s more than was paid ($15.00).',
      });
      expect(await ask(id, 100, {})).toEqual({
        ok: false,
        reason: 'Paddle’s keys aren’t set, so its refund event couldn’t arrive.',
      });
      s.api.fail('POST', '/adjustments', 400, 'adjustment_amount_above_remaining_allowed');
      expect(await ask(id, 100)).toEqual({
        ok: false,
        reason: 'Paddle refused the refund. Check the purchase in Paddle’s dashboard.',
      });
      const pending = await newPurchase(db, await newUser(db));
      expect(await ask(pending, 100)).toEqual({
        ok: false,
        reason: 'A pending purchase can’t be refunded.',
      });
      const paymeBuyer = await newUser(db);
      const paymeId = await newPurchase(db, paymeBuyer, {
        provider: 'payme',
        currency: 'UZS',
        amountMinor: 6_300_000,
        credits: 200,
      });
      await createPurchaseStore(db).complete(paymeId);
      expect(
        await requestRefund(
          db,
          { adminId: admin, purchaseId: paymeId, amountMinor: 100, reason: 'Testing refusals' },
          {
            ...env(),
            vars: { ...PADDLE_VARS, PAYME_MERCHANT_ID: 'm', PAYME_KEY: 'k', PAYME_TEST: 'true' },
          },
          s.context,
        ),
      ).toEqual({ ok: false, reason: 'Payme refunds are made in Payme’s own cabinet.' });
      expect(await ask(randomUUID(), 100)).toEqual({ ok: false, reason: 'No such purchase.' });
      expect(await audited(id)).toEqual([]);
    });
  });

  describe('Click, recorded by hand', () => {
    /** A Starter pack in sum (63,000 UZS, 200 credits), paid. */
    async function paidClick() {
      const userId = await newUser(db);
      const id = await newPurchase(db, userId, {
        provider: 'click',
        packId: 'starter',
        credits: 200,
        amountMinor: 6_300_000,
        currency: 'UZS',
      });
      await createPurchaseStore(db).complete(id);
      return { userId, id };
    }

    const record = (purchaseId: string, amountMinor: number, refundId = randomUUID()) =>
      recordCabinetRefund(db, {
        adminId: admin,
        purchaseId,
        refundId,
        amountMinor,
        reason: 'Refunded in Click’s cabinet',
      });

    it('takes the credits back in proportion, once per form, never past what was paid', async () => {
      const { userId, id } = await paidClick();
      const form = randomUUID();
      // 47,250 of 63,000 UZS: three quarters, 150 credits.
      expect(await record(id, 4_725_000, form)).toEqual({ ok: true, status: 'partially_refunded' });
      expect(await balanceOf(db, userId)).toBe(50);
      // The same form submitted twice: recorded once.
      expect(await record(id, 4_725_000, form)).toEqual({ ok: true, status: 'partially_refunded' });
      expect(await refundRows(id)).toEqual([-150]);
      // More money than is left of the payment.
      expect(await record(id, 1_575_001)).toEqual({
        ok: false,
        reason: 'That’s more than is left to refund (15,750 UZS of 63,000 UZS).',
      });
      // The rest of it: the rest of the credits.
      expect(await record(id, 1_575_000)).toEqual({ ok: true, status: 'refunded' });
      expect(await balanceOf(db, userId)).toBe(0);
      expect(await refundRows(id)).toEqual([-150, -50]);
      expect(await record(id, 100)).toEqual({
        ok: false,
        reason: 'A refunded purchase can’t be refunded.',
      });
      const entries = await audited(id);
      expect(entries.map((row) => [row.action, row.after])).toEqual([
        [
          'purchase.refund_recorded',
          {
            status: 'partially_refunded',
            refunded_minor: 4_725_000,
            currency: 'UZS',
            credits_back: 150,
          },
        ],
        [
          'purchase.refund_recorded',
          { status: 'refunded', refunded_minor: 1_575_000, currency: 'UZS', credits_back: 50 },
        ],
      ]);
    });

    it('may take the balance below zero when the credits were spent since', async () => {
      const { userId, id } = await paidClick();
      // 150 of the 200 credits went on jobs after the admin looked.
      await applyCredit(db, userId, 'admin_debit', -150, { adminId: admin, reason: 'jobs' });
      expect(await record(id, 4_725_000)).toEqual({ ok: true, status: 'partially_refunded' });
      expect(await balanceOf(db, userId)).toBe(-100);
      expect(await refundRows(id)).toEqual([-150]);
    });

    it('lets one of two refunds recorded at once through when both together pass the payment', async () => {
      const { id } = await paidClick();
      const results = await Promise.all([record(id, 4_000_000), record(id, 4_000_000)]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, reason: 'That’s more than is left to refund (23,000 UZS of 63,000 UZS).' },
      ]);
      expect(await refundRows(id)).toHaveLength(1);
    });

    it('refuses other providers, unpaid purchases and unknown ones', async () => {
      const userId = await newUser(db);
      const paddleId = await newPurchase(db, userId);
      await createPurchaseStore(db).complete(paddleId);
      expect(await record(paddleId, 100)).toEqual({
        ok: false,
        reason: 'Only Click refunds are recorded by hand.',
      });
      const pending = await newPurchase(db, userId, { provider: 'click', currency: 'UZS' });
      expect(await record(pending, 100)).toEqual({
        ok: false,
        reason: 'A pending purchase can’t be refunded.',
      });
      expect(await record(randomUUID(), 100)).toEqual({ ok: false, reason: 'No such purchase.' });
      expect(await refundRows(paddleId)).toEqual([]);
    });
  });
});
