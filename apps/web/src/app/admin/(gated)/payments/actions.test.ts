/**
 * Admin → Payments → Refund and Record refund, as their forms call them, on
 * a real Postgres (TEST_DATABASE_URL; skipped without it). Next's redirect,
 * the admin gate, the server's env and the provider's API are stand-ins;
 * the form parsing, the store, the ledger and the audit log are real.
 */
import { randomUUID } from 'node:crypto';

import { adminAuditLog, and, eq, type Db } from '@etb/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PaymentProvider, PurchaseRecord } from '../../../../server/payments/contract';
import { createPurchaseStore } from '../../../../server/payments/store';
import type { PaymentEnv } from '../../../../server/payments/switches';
import {
  balanceOf,
  newPurchase,
  newUser,
  openTestDb,
  TEST_DATABASE_URL,
} from '../../../../server/test-db';

const fixture = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  const held: { Redirect: typeof Redirect; db?: Db; adminId: string; env?: PaymentEnv } = {
    Redirect,
    adminId: '',
  };
  return held;
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new fixture.Redirect(url);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../../../../server/admin', () => ({
  requireAdmin: () => Promise.resolve({ id: fixture.adminId }),
}));
vi.mock('../../../../server/db', () => ({ db: () => fixture.db }));
vi.mock('../../../../server/env', () => ({
  serverEnv: () => ({ SITE_URL: 'http://site.test' }),
}));
vi.mock('../../../../server/payments/switches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../server/payments/switches')>()),
  paymentEnv: () => fixture.env,
}));

/** Where the action sent the admin: the page, and its `saved` or `error`. */
async function landing(
  action: Promise<void>,
): Promise<{ saved: string | null; error: string | null }> {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof fixture.Redirect)) throw error;
    const url = new URL(error.url, 'http://site.test');
    expect(url.pathname).toBe('/admin/payments');
    return { saved: url.searchParams.get('saved'), error: url.searchParams.get('error') };
  }
  throw new Error('the action did not redirect');
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe.skipIf(!TEST_DATABASE_URL)('Admin → Payments refund actions', () => {
  let db: Db;
  let close: () => Promise<void>;
  let actions: typeof import('./actions');
  const asked: { purchase: PurchaseRecord; amountMinor: number }[] = [];
  // Paddle's API, played: the refund request is what the action hands it.
  const paddle: PaymentProvider = {
    id: 'paddle',
    currency: 'USD',
    requiredEnv: [],
    createCheckout: () => Promise.reject(new Error('not in this test')),
    handleWebhook: () => Promise.reject(new Error('not in this test')),
    refund: (purchase, _ctx, amountMinor) => {
      asked.push({ purchase, amountMinor });
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    fixture.db = db;
    fixture.adminId = await newUser(db);
    // Switched off, keys set: refunds still work.
    fixture.env = {
      enabled: false,
      vars: {},
      providers: [paddle],
      fiscal: { mxik: '', packageCode: '' },
      unfinished: {},
    } satisfies PaymentEnv;
    actions = await import('./actions');
  });

  afterAll(async () => {
    await close();
  });

  const audited = (purchaseId: string) =>
    db
      .select()
      .from(adminAuditLog)
      .where(
        and(eq(adminAuditLog.adminId, fixture.adminId), eq(adminAuditLog.targetId, purchaseId)),
      );

  it('Record refund: takes back the credits for the sum refunded in Click’s cabinet', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId, {
      provider: 'click',
      packId: 'starter',
      credits: 200,
      amountMinor: 6_300_000,
      currency: 'UZS',
    });
    await createPurchaseStore(db).complete(id);
    const fields = {
      purchaseId: id,
      refundId: randomUUID(),
      amount: '47 250',
      reason: 'Unused credits, refunded in Click',
    };
    expect(await landing(actions.recordRefund(form(fields)))).toEqual({
      saved: 'recorded',
      error: null,
    });
    expect(await balanceOf(db, userId)).toBe(50);
    // The same form again (a double click): nothing more.
    expect((await landing(actions.recordRefund(form(fields)))).saved).toBe('recorded');
    expect(await balanceOf(db, userId)).toBe(50);
    expect((await audited(id)).map((row) => [row.action, row.reason])).toEqual([
      ['purchase.refund_recorded', 'Unused credits, refunded in Click'],
    ]);

    // A form that doesn't parse changes nothing.
    for (const [bad, message] of [
      [{ amount: '47,250' }, 'Give the amount refunded, like 3.75 or 47250.'],
      [{ reason: 'no' }, 'Give a reason of 3 to 500 characters.'],
      [{ refundId: 'x' }, 'Reload the page and try again.'],
    ] as const) {
      expect(
        await landing(actions.recordRefund(form({ ...fields, refundId: randomUUID(), ...bad }))),
      ).toEqual({ saved: null, error: message });
    }
    expect(await balanceOf(db, userId)).toBe(50);
  });

  it('Refund: asks the provider for the amount given, and audits it', async () => {
    const userId = await newUser(db);
    const id = await newPurchase(db, userId);
    await createPurchaseStore(db).complete(id);
    expect(
      await landing(
        actions.refundPurchase(
          form({ purchaseId: id, amount: '12.86', reason: 'Asked within 14 days' }),
        ),
      ),
    ).toEqual({ saved: 'refund', error: null });
    expect(asked.map((call) => [call.purchase.id, call.amountMinor])).toEqual([[id, 1286]]);
    expect((await audited(id)).map((row) => [row.action, row.after])).toEqual([
      ['purchase.refund', { requested_minor: 1286, currency: 'USD' }],
    ]);
    // Credits come off only when the provider says so.
    expect(await balanceOf(db, userId)).toBe(700);

    expect(
      await landing(
        actions.refundPurchase(form({ purchaseId: id, amount: '15.01', reason: 'Too much' })),
      ),
    ).toEqual({ saved: null, error: 'That’s more than was paid ($15.00).' });
    expect(asked).toHaveLength(1);
  });
});
