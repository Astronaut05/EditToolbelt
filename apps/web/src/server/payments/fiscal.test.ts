/**
 * Click's fiscal receipts: the backoff, then the queue on a real Postgres
 * (TEST_DATABASE_URL; those tests skip without it). Click's API is a fake
 * fetch. Other test files may leave receipts in the same database, so each
 * test follows its own purchases' receipts only.
 */
import { randomInt, randomUUID } from 'node:crypto';

import type { FiscalReceiptConfig } from '@etb/config/business';
import { adminAuditLog, and, eq, fiscalReceipts, type Db } from '@etb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newPurchase, newUser, openTestDb, TEST_DATABASE_URL } from '../test-db';
import type { ClickReceiptBody } from './providers/click-merchant';
import {
  canSend,
  retryDelayMs,
  sendDueReceipts,
  sendReceiptAgain,
  type FiscalDeps,
} from './fiscal';
import { createPurchaseStore } from './store';

const MINUTE = 60_000;

const ENV = {
  CLICK_SERVICE_ID: '12345',
  CLICK_MERCHANT_USER_ID: '3333',
  CLICK_SECRET_KEY: 'SECRET123',
  CLICK_MERCHANT_API_URL: 'https://merchant.click.test/v2/merchant/',
};

const FISCAL: FiscalReceiptConfig = {
  mxik: '10305001001000000',
  packageCode: '1545643',
  vatPercent: 12,
  tin: '301234567',
  pinfl: '',
};

describe('retryDelayMs', () => {
  it('waits 1, 2, 4 … minutes after each failed try, at most 6 hours', () => {
    expect([1, 2, 3, 4, 5, 6].map((tries) => retryDelayMs(tries) / MINUTE)).toEqual([
      1, 2, 4, 8, 16, 32,
    ]);
    expect(retryDelayMs(9) / MINUTE).toBe(256);
    expect(retryDelayMs(10) / MINUTE).toBe(360);
    expect(retryDelayMs(1000) / MINUTE).toBe(360);
    expect(retryDelayMs(0) / MINUTE).toBe(1);
  });
});

describe('canSend', () => {
  it('needs Click’s service id, merchant user id, secret key and Merchant API URL', () => {
    expect(canSend(ENV)).toBe(true);
    for (const name of Object.keys(ENV)) expect(canSend({ ...ENV, [name]: ' ' })).toBe(false);
  });
});

/** Click's Merchant API, played: answers in turn, and every body it got. */
class FakeClick {
  readonly bodies: ClickReceiptBody[] = [];
  answer: () => Promise<Response> = () => Promise.resolve(Response.json({ error_code: 0 }));

  readonly fetch = (_url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('expected a JSON body');
    this.bodies.push(JSON.parse(body) as ClickReceiptBody);
    return this.answer();
  };

  /** The tries Click saw for one payment id. */
  triesFor(paymentId: string): number {
    return this.bodies.filter((body) => String(body.payment_id) === paymentId).length;
  }
}

describe.skipIf(!TEST_DATABASE_URL)('Click’s fiscal receipts on the database', () => {
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

  /** A Click purchase completed by the store as Click's Complete does it. */
  async function soldOnClick(): Promise<{ purchaseId: string; paymentId: string }> {
    const user = await newUser(db);
    const purchaseId = await newPurchase(db, user, {
      provider: 'click',
      packId: 'starter',
      credits: 200,
      amountMinor: 6_300_000,
      currency: 'UZS',
    });
    const paymentId = String(randomInt(1, 2 ** 47));
    await createPurchaseStore(db).complete(purchaseId, {}, `ct-${randomUUID()}`, { paymentId });
    return { purchaseId, paymentId };
  }

  async function receiptOf(purchaseId: string) {
    const [row] = await db
      .select()
      .from(fiscalReceipts)
      .where(eq(fiscalReceipts.purchaseId, purchaseId));
    if (!row) throw new Error('no receipt');
    return row;
  }

  function deps(click: FakeClick, at: Date, overrides: Partial<FiscalDeps> = {}): FiscalDeps {
    return { env: ENV, fiscal: FISCAL, fetch: click.fetch, now: () => at, ...overrides };
  }

  // Receipts other files left due are sent too: no limit, so ours is always reached.
  const sendDue = (given: FiscalDeps) => sendDueReceipts(db, given, 10_000);

  it('queues one receipt with the credits, and none for a sale without one', async () => {
    const { purchaseId, paymentId } = await soldOnClick();
    expect(await receiptOf(purchaseId)).toMatchObject({
      paymentId,
      status: 'pending',
      attempts: 0,
      lastError: null,
      sentAt: null,
    });
    // A repeated Complete adds nothing.
    await createPurchaseStore(db).complete(purchaseId, {}, undefined, { paymentId: '1' });
    const rows = await db
      .select()
      .from(fiscalReceipts)
      .where(eq(fiscalReceipts.purchaseId, purchaseId));
    expect(rows.map((row) => row.paymentId)).toEqual([paymentId]);

    const paddle = await newPurchase(db, await newUser(db));
    await createPurchaseStore(db).complete(paddle, {}, `txn_${randomUUID()}`);
    expect(
      await db.select().from(fiscalReceipts).where(eq(fiscalReceipts.purchaseId, paddle)),
    ).toEqual([]);
  });

  it('retries a refused receipt with backoff until Click accepts it', async () => {
    const { purchaseId, paymentId } = await soldOnClick();
    const click = new FakeClick();
    const t0 = new Date(Date.now() + 5_000);
    click.answer = () =>
      Promise.resolve(Response.json({ error_code: -5, error_note: 'Payment not found' }));

    await sendDue(deps(click, t0));
    expect(click.triesFor(paymentId)).toBe(1);
    const sentBody = click.bodies.find((body) => String(body.payment_id) === paymentId);
    expect(sentBody).toMatchObject({
      service_id: 12345,
      items: [
        { SPIC: FISCAL.mxik, Price: 6_300_000, VAT: 675_000, CommissionInfo: { TIN: FISCAL.tin } },
      ],
      received_ecash: 6_300_000,
    });
    let row = await receiptOf(purchaseId);
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Click refused it: -5 Payment not found',
    });
    expect(row.nextAttemptAt.getTime()).toBe(t0.getTime() + MINUTE);

    // Not due again yet.
    await sendDue(deps(click, new Date(t0.getTime() + 59_000)));
    expect(click.triesFor(paymentId)).toBe(1);

    // Due after a minute: a second refusal waits 2 minutes.
    const t1 = new Date(t0.getTime() + MINUTE);
    await sendDue(deps(click, t1));
    row = await receiptOf(purchaseId);
    expect(row).toMatchObject({ status: 'failed', attempts: 2 });
    expect(row.nextAttemptAt.getTime()).toBe(t1.getTime() + 2 * MINUTE);

    // No answer at all is a failed try too.
    const t2 = new Date(t1.getTime() + 2 * MINUTE);
    click.answer = () => Promise.reject(new TypeError('fetch failed'));
    await sendDue(deps(click, t2));
    row = await receiptOf(purchaseId);
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'Click didn’t answer (TypeError).',
    });

    const t3 = new Date(t2.getTime() + 4 * MINUTE);
    click.answer = () => Promise.resolve(Response.json({ error_code: 0, error_note: 'Success' }));
    await sendDue(deps(click, t3));
    row = await receiptOf(purchaseId);
    expect(row).toMatchObject({ status: 'sent', attempts: 4, lastError: null, sentAt: t3 });

    // Sent: never again.
    await sendDue(deps(click, new Date(t3.getTime() + 24 * 60 * MINUTE)));
    expect(click.triesFor(paymentId)).toBe(4);
  });

  it('records what config/business.ts lacks without asking Click, and tries again later', async () => {
    const { purchaseId, paymentId } = await soldOnClick();
    const click = new FakeClick();
    const at = new Date(Date.now() + 5_000);
    await sendDue(deps(click, at, { fiscal: { ...FISCAL, mxik: '', tin: '' } }));
    expect(click.triesFor(paymentId)).toBe(0);
    expect(await receiptOf(purchaseId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'fiscalReceipt.mxik is empty. fiscalReceipt.tin or fiscalReceipt.pinfl is empty.',
    });
  });

  it('sends nothing, and changes nothing, while Click’s keys or URL are unset', async () => {
    const { purchaseId } = await soldOnClick();
    const click = new FakeClick();
    const at = new Date(Date.now() + 5_000);
    const summary = await sendDue(
      deps(click, at, { env: { ...ENV, CLICK_MERCHANT_API_URL: undefined } }),
    );
    expect(summary).toEqual({ sent: 0, failed: 0, skipped: true });
    expect(click.bodies).toEqual([]);
    expect(await receiptOf(purchaseId)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('never sends a receipt another sender holds', async () => {
    const { purchaseId, paymentId } = await soldOnClick();
    const click = new FakeClick();
    const at = new Date(Date.now() + 5_000);
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(fiscalReceipts)
        .where(eq(fiscalReceipts.purchaseId, purchaseId))
        .for('update');
      await sendDue(deps(click, at));
      expect(
        await sendReceiptAgain(
          db,
          { adminId: admin, purchaseId, reason: 'Retry' },
          deps(click, at),
        ),
      ).toEqual({ ok: false, reason: 'It’s being sent right now. Look again in a minute.' });
    });
    expect(click.triesFor(paymentId)).toBe(0);
    await sendDue(deps(click, at));
    expect(click.triesFor(paymentId)).toBe(1);
  });

  it('“Send again” tries now, whenever the next try was due, into the audit log', async () => {
    const { purchaseId, paymentId } = await soldOnClick();
    const click = new FakeClick();
    const at = new Date(Date.now() + 5_000);
    click.answer = () => Promise.resolve(Response.json({ error_code: -9, error_note: 'Busy' }));
    await sendDue(deps(click, at));

    const refused = await sendReceiptAgain(
      db,
      { adminId: admin, purchaseId, reason: 'Click says it was busy' },
      deps(click, at),
    );
    expect(refused).toEqual({ ok: true, status: 'failed', error: 'Click refused it: -9 Busy' });
    expect(await receiptOf(purchaseId)).toMatchObject({ status: 'failed', attempts: 2 });

    click.answer = () => Promise.resolve(Response.json({ error_code: 0 }));
    const sent = await sendReceiptAgain(
      db,
      { adminId: admin, purchaseId, reason: 'Click is back' },
      deps(click, at),
    );
    expect(sent).toEqual({ ok: true, status: 'sent', error: null });
    expect(click.triesFor(paymentId)).toBe(3);

    const entries = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.adminId, admin), eq(adminAuditLog.targetId, purchaseId)));
    expect(entries.map((entry) => [entry.action, entry.reason, entry.after])).toEqual([
      [
        'purchase.fiscal_receipt_resend',
        'Click says it was busy',
        { status: 'failed', attempts: 2, error: 'Click refused it: -9 Busy' },
      ],
      [
        'purchase.fiscal_receipt_resend',
        'Click is back',
        { status: 'sent', attempts: 3, error: null },
      ],
    ]);

    // Sent, missing, no reason, no keys: refused, and nothing is sent or logged.
    const again = (purchase: string, reason = 'Once more', env = ENV) =>
      sendReceiptAgain(
        db,
        { adminId: admin, purchaseId: purchase, reason },
        deps(click, at, { env }),
      );
    expect(await again(purchaseId)).toEqual({ ok: false, reason: 'Click already accepted it.' });
    expect(await again(randomUUID())).toEqual({
      ok: false,
      reason: 'This purchase has no fiscal receipt.',
    });
    expect(await again(purchaseId, ' x ')).toEqual({
      ok: false,
      reason: 'Give a reason of 3 to 500 characters.',
    });
    expect(await again(purchaseId, 'Once more', { ...ENV, CLICK_SECRET_KEY: '' })).toMatchObject({
      ok: false,
    });
    expect(click.triesFor(paymentId)).toBe(3);
    expect(
      await db
        .select()
        .from(adminAuditLog)
        .where(and(eq(adminAuditLog.adminId, admin), eq(adminAuditLog.targetId, purchaseId))),
    ).toHaveLength(2);
  });
});
