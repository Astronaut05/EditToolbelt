/**
 * The switches and checkout on a real Postgres (TEST_DATABASE_URL; skipped
 * without it). One file, so its tests run in turn: they share payment_settings.
 */
import { adminAuditLog, eq, paymentSettings, purchases, type Db } from '@etb/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../problem';
import { newUser, openTestDb, TEST_DATABASE_URL } from '../test-db';
import { buyUrl, ownPurchase, purchaseView, startCheckout } from './checkout';
import type { Checkout, PaymentProvider, ProviderId, PurchaseRecord } from './contract';
import {
  canBuyCredits,
  enabledProvider,
  enabledProviders,
  paymentStates,
  setProviderSwitch,
  type PaymentEnv,
} from './switches';

const SITE = 'http://site.test';

function fake(
  id: ProviderId,
  checkout: (purchase: PurchaseRecord) => Promise<Checkout>,
): PaymentProvider & { seen: PurchaseRecord[] } {
  const seen: PurchaseRecord[] = [];
  return {
    id,
    currency: id === 'paddle' ? 'USD' : 'UZS',
    requiredEnv: [],
    seen,
    createCheckout: (purchase) => {
      seen.push(purchase);
      return checkout(purchase);
    },
    handleWebhook: () => Promise.resolve(new Response('ok')),
  };
}

describe.skipIf(!TEST_DATABASE_URL)('checkout', () => {
  let db: Db;
  let close: () => Promise<void>;
  const paddle = fake('paddle', (p) =>
    Promise.resolve({ kind: 'redirect', url: `https://pay.example.test/${p.id}` }),
  );
  const click = fake('click', () =>
    Promise.resolve({ kind: 'redirect', url: 'https://click.example.test/pay' }),
  );
  const payme = fake('payme', () => Promise.reject(new Error('Payme is down')));
  const env = (enabled = true): PaymentEnv => ({
    enabled,
    vars: {},
    providers: [paddle, click, payme],
    fiscal: { mxik: '1', packageCode: '2' },
  });

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });

  beforeEach(async () => {
    await db.update(paymentSettings).set({ enabled: false });
  });

  afterAll(async () => {
    await db.update(paymentSettings).set({ enabled: false });
    await close();
  });

  async function switchOn(...ids: ProviderId[]) {
    for (const provider of ids) {
      await db
        .insert(paymentSettings)
        .values({ provider, enabled: true, reason: 'test' })
        .onConflictDoUpdate({ target: paymentSettings.provider, set: { enabled: true } });
    }
  }

  async function status(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return 'ok';
    } catch (error) {
      if (error instanceof ApiError) return `${String(error.status)} ${error.code}`;
      throw error;
    }
  }

  it('is a 404 while payments or the provider are off', async () => {
    const userId = await newUser(db);
    const user = { id: userId, email: 'a@example.test' };
    const request = { packId: 'starter' as const, provider: 'paddle' as const };
    expect(await status(startCheckout(db, user, request, env(), SITE))).toBe('404 NOT_FOUND');
    await switchOn('paddle');
    expect(await status(startCheckout(db, user, request, env(false), SITE))).toBe('404 NOT_FOUND');
    expect(
      await status(startCheckout(db, user, { ...request, provider: 'click' }, env(), SITE)),
    ).toBe('404 NOT_FOUND');
    expect(await db.select().from(purchases).where(eq(purchases.userId, userId))).toEqual([]);
    expect(await buyUrl(db, env(false), SITE)).toBeNull();
    expect(await buyUrl(db, env(), SITE)).toBe(`${SITE}/credits/buy`);
  });

  it('creates a pending purchase at the pack’s price in the provider’s currency', async () => {
    await switchOn('paddle', 'click');
    const userId = await newUser(db);
    const user = { id: userId, email: 'b@example.test' };
    const usd = await startCheckout(
      db,
      user,
      { packId: 'creator', provider: 'paddle' },
      env(),
      SITE,
    );
    expect(usd.checkout).toEqual({
      kind: 'redirect',
      url: `https://pay.example.test/${usd.purchase_id}`,
    });
    expect(paddle.seen.at(-1)).toMatchObject({
      id: usd.purchase_id,
      userId,
      status: 'pending',
      credits: 700,
      amountMinor: 1500,
      currency: 'USD',
      providerTxnId: null,
    });
    const uzs = await startCheckout(db, user, { packId: 'studio', provider: 'click' }, env(), SITE);
    const row = await ownPurchase(db, userId, uzs.purchase_id);
    expect(purchaseView(row)).toMatchObject({
      status: 'pending',
      provider: 'click',
      pack_id: 'studio',
      credits: 2000,
      amount_minor: 49_900_000,
      currency: 'UZS',
    });
    // Someone else's purchase, or a malformed id, is "not found".
    const other = await newUser(db);
    expect(await status(ownPurchase(db, other, uzs.purchase_id))).toBe('404 NOT_FOUND');
    expect(await status(ownPurchase(db, userId, 'nope'))).toBe('404 NOT_FOUND');
  });

  it('cancels the purchase when the provider fails, and says so', async () => {
    await switchOn('payme');
    const userId = await newUser(db);
    const answer = await status(
      startCheckout(
        db,
        { id: userId, email: null },
        { packId: 'starter', provider: 'payme' },
        env(),
        SITE,
      ),
    );
    expect(answer).toBe('502 PROVIDER_UNAVAILABLE');
    const rows = await db.select().from(purchases).where(eq(purchases.userId, userId));
    expect(rows.map((r) => [r.status, r.providerData])).toEqual([
      ['cancelled', { checkoutFailed: true }],
    ]);
  });

  it('refuses a checkout a browser can’t follow', async () => {
    const odd = fake('paddle', () =>
      Promise.resolve({ kind: 'redirect', url: 'javascript:alert(1)' }),
    );
    await switchOn('paddle');
    const userId = await newUser(db);
    const answer = await status(
      startCheckout(
        db,
        { id: userId, email: null },
        { packId: 'starter', provider: 'paddle' },
        { ...env(), providers: [odd] },
        SITE,
      ),
    );
    expect(answer).toBe('502 PROVIDER_UNAVAILABLE');
  });
});

function fakeProvider(id: ProviderId, requiredEnv: string[]): PaymentProvider {
  return {
    id,
    currency: id === 'paddle' ? 'USD' : 'UZS',
    requiredEnv,
    createCheckout: () => Promise.resolve({ kind: 'redirect', url: 'https://pay.example.test' }),
    handleWebhook: () => Promise.resolve(new Response('ok')),
  };
}

const PADDLE = fakeProvider('paddle', ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET']);
const CLICK = fakeProvider('click', ['CLICK_SECRET_KEY']);
const PAYME = fakeProvider('payme', ['PAYME_KEY']);

const FISCAL = { mxik: '10305001001000000', packageCode: '1545643' };
const NO_FISCAL = { mxik: '', packageCode: ' ' };

function switchEnv(overrides: Partial<PaymentEnv> = {}): PaymentEnv {
  return {
    enabled: true,
    vars: {
      PADDLE_API_KEY: 'k',
      PADDLE_WEBHOOK_SECRET: 's',
      CLICK_SECRET_KEY: 'c',
      PAYME_KEY: 'p',
    },
    providers: [PADDLE, CLICK, PAYME],
    fiscal: FISCAL,
    ...overrides,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('the switches in the database', () => {
  let db: Db;
  let close: () => Promise<void>;
  let admin: string;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    admin = await newUser(db);
  });

  beforeEach(async () => {
    // Other test files may share the database: start each test with every switch off.
    await db.update(paymentSettings).set({ enabled: false });
  });

  afterAll(async () => {
    await db.update(paymentSettings).set({ enabled: false });
    await close();
  });

  it('starts off: nothing enabled, nothing to buy, every webhook path closed', async () => {
    expect(await enabledProviders(db, switchEnv())).toEqual([]);
    expect(await canBuyCredits(db, switchEnv())).toBe(false);
    expect(await enabledProvider(db, 'paddle', switchEnv())).toBeNull();
    expect((await paymentStates(db, switchEnv())).map((s) => [s.id, s.switchedOn])).toEqual([
      ['paddle', false],
      ['click', false],
      ['payme', false],
    ]);
  });

  it('turns a provider on with a reason, into the audit log, and off again', async () => {
    const result = await setProviderSwitch(
      db,
      { adminId: admin, provider: 'paddle', enabled: true, reason: 'Sandbox test purchase' },
      switchEnv(),
    );
    expect(result).toEqual({ ok: true, changed: true });
    expect((await enabledProviders(db, switchEnv())).map((p) => p.id)).toEqual(['paddle']);
    expect(await enabledProvider(db, 'paddle', switchEnv())).toBe(PADDLE);
    expect(await enabledProvider(db, 'click', switchEnv())).toBeNull();
    expect(await enabledProvider(db, 'stripe', switchEnv())).toBeNull();
    expect(await canBuyCredits(db, switchEnv())).toBe(true);
    // The kill switch closes everything, whatever the admin set.
    expect(await enabledProviders(db, switchEnv({ enabled: false }))).toEqual([]);
    expect(await enabledProvider(db, 'paddle', switchEnv({ enabled: false }))).toBeNull();

    const [row] = await db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.provider, 'paddle'));
    expect(row).toMatchObject({ enabled: true, updatedBy: admin, reason: 'Sandbox test purchase' });

    await setProviderSwitch(
      db,
      { adminId: admin, provider: 'paddle', enabled: false, reason: 'Done testing' },
      switchEnv(),
    );
    expect(await enabledProviders(db, switchEnv())).toEqual([]);
    const entries = await db.select().from(adminAuditLog).where(eq(adminAuditLog.adminId, admin));
    expect(entries.map((e) => [e.action, e.targetId, e.reason])).toEqual([
      ['payments.provider_on', 'paddle', 'Sandbox test purchase'],
      ['payments.provider_off', 'paddle', 'Done testing'],
    ]);
  });

  it('refuses to turn on while keys or fiscal fields are missing, and changes nothing', async () => {
    const audited = () => db.select().from(adminAuditLog).where(eq(adminAuditLog.adminId, admin));
    const before = await audited();
    const noKeys = await setProviderSwitch(
      db,
      { adminId: admin, provider: 'click', enabled: true, reason: 'Try it' },
      switchEnv({ vars: {} }),
    );
    expect(noKeys).toEqual({
      ok: false,
      reason:
        'Click can’t be switched on yet. CLICK_SECRET_KEY is not set (a Railway shared variable on the web service).',
    });
    const noFiscal = await setProviderSwitch(
      db,
      { adminId: admin, provider: 'payme', enabled: true, reason: 'Try it' },
      switchEnv({ fiscal: NO_FISCAL }),
    );
    expect(noFiscal.ok).toBe(false);
    if (!noFiscal.ok) expect(noFiscal.reason).toMatch(/fiscalReceipt\.mxik is empty/);
    const noReason = await setProviderSwitch(
      db,
      { adminId: admin, provider: 'paddle', enabled: true, reason: ' x ' },
      switchEnv(),
    );
    expect(noReason).toEqual({ ok: false, reason: 'Give a reason of 3 to 500 characters.' });
    expect(await audited()).toHaveLength(before.length);
    expect(await enabledProviders(db, switchEnv())).toEqual([]);
    // Turning off always works, even without keys.
    expect(
      await setProviderSwitch(
        db,
        { adminId: admin, provider: 'click', enabled: false, reason: 'Keep it off' },
        switchEnv({ vars: {} }),
      ),
    ).toEqual({ ok: true, changed: false });
  });

  it('stops a switched-on provider when its key goes away', async () => {
    await setProviderSwitch(
      db,
      { adminId: admin, provider: 'payme', enabled: true, reason: 'Live' },
      switchEnv(),
    );
    expect((await enabledProviders(db, switchEnv())).map((p) => p.id)).toEqual(['payme']);
    expect(await enabledProviders(db, switchEnv({ vars: { PAYME_KEY: '' } }))).toEqual([]);
  });
});
