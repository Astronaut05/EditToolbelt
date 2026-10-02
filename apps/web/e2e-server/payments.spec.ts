/**
 * Payments on the server build (docs/05 → Payments; docs/DECISIONS.md →
 * "Payments: three providers behind one interface, built and switched off").
 * The test env has PAYMENTS_ENABLED=true and the stub standing in for Paddle
 * with its key (scripts/server-env.ts), so the only lock left is the admin's
 * switch per provider: off by default, and off again after each test.
 */
import { adminAuditLog, and, eq, paymentSettings, purchases, users } from '@etb/db';
import { expect, test, type APIRequestContext } from '@playwright/test';

import { PAYMENTS_STUB_KEY, SERVER_PORT } from '../scripts/server-env.ts';
import { becomeAdmin, closeTestDb, newEmail, signIn, testDb } from './helpers';

const db = testDb();
const ORIGIN = `http://localhost:${String(SERVER_PORT)}`;
const PROVIDERS = ['paddle', 'click', 'payme'] as const;

// Every test shares the switches, so one at a time, each from all off.
test.describe.configure({ mode: 'serial', timeout: 90_000 });

async function allOff() {
  await db.update(paymentSettings).set({ enabled: false });
}

test.beforeEach(allOff);

test.afterAll(async () => {
  await allOff();
  await closeTestDb();
});

const checkout = (request: APIRequestContext, body: unknown, headers = {}) =>
  request.post('/api/v1/credits/checkout', {
    data: body,
    headers: { Origin: ORIGIN, ...headers },
  });

test('payments are off by default: no buy links, and every payment path is a 404', async ({
  page,
  request,
}) => {
  expect((await request.get('/credits/buy')).status()).toBe(404);
  expect((await checkout(request, { pack_id: 'starter', provider: 'paddle' })).status()).toBe(404);
  for (const provider of PROVIDERS) {
    expect((await request.post(`/api/webhooks/${provider}`, { data: {} })).status()).toBe(404);
    expect((await request.get(`/api/webhooks/${provider}`)).status()).toBe(404);
  }
  expect((await request.post('/api/webhooks/stripe', { data: {} })).status()).toBe(404);

  await signIn(page, newEmail());
  await expect(page.getByRole('heading', { name: 'Credits' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buy credits' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Purchases' })).toHaveCount(0);
  const me = (await (await page.request.get('/api/v1/me')).json()) as { buy_url: string | null };
  expect(me.buy_url).toBeNull();
  expect((await page.goto('/credits/buy'))?.status()).toBe(404);
  const answer = await checkout(page.request, { pack_id: 'starter', provider: 'paddle' });
  expect(answer.status()).toBe(404);
  expect(await answer.json()).toMatchObject({ code: 'NOT_FOUND' });
});

test('switching a provider on is refused while its keys are missing', async ({ page }) => {
  const admin = await becomeAdmin(page);
  await page.goto('/admin/payments');
  await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible();
  const click = page.locator('section#click');
  await expect(click.getByText('fiscalReceipt.mxik', { exact: true })).toBeVisible();
  await click.getByLabel('Reason (goes into the audit log)').fill('Try Click');
  await click.getByRole('button', { name: 'Switch Click on' }).click();
  await expect(page).toHaveURL(/[?&]error=/, { timeout: 30_000 });
  await expect(page.locator('section#click').getByRole('alert')).toContainText(
    'Click can’t be switched on yet',
  );
  const [row] = await db
    .select()
    .from(paymentSettings)
    .where(eq(paymentSettings.provider, 'click'));
  expect(row?.enabled ?? false).toBe(false);
  const audited = await db
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.adminId, admin.id), eq(adminAuditLog.targetId, 'click')));
  expect(audited).toEqual([]);
});

test('switched on, a checkout makes a pending purchase and the provider’s call adds the credits', async ({
  page,
  request,
  browser,
}) => {
  const admin = await becomeAdmin(page);
  await page.goto('/admin/payments');
  const paddle = page.locator('section#paddle');
  await expect(paddle.getByText('PAYMENTS_STUB_KEY', { exact: true })).toBeVisible();
  await paddle.getByLabel('Reason (goes into the audit log)').fill('End-to-end purchase');
  await paddle.getByRole('button', { name: 'Switch Paddle on' }).click();
  await expect(page).toHaveURL(/[?&]saved=on/, { timeout: 30_000 });
  await expect(page.getByRole('main').getByRole('status')).toContainText('Switched on');
  const [entry] = await db
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.adminId, admin.id), eq(adminAuditLog.targetId, 'paddle')));
  expect(entry).toMatchObject({ action: 'payments.provider_on', reason: 'End-to-end purchase' });

  // The API: session only, Zod-checked, a pending purchase at the pack's price.
  expect(
    (
      await checkout(
        page.request,
        { pack_id: 'starter', provider: 'paddle' },
        {
          Authorization: 'Bearer etb_live_not-a-key',
        },
      )
    ).status(),
  ).toBe(403);
  expect((await checkout(request, { pack_id: 'starter', provider: 'paddle' })).status()).toBe(401);
  const bad = await checkout(page.request, { pack_id: 'huge', provider: 'paddle' });
  expect(bad.status()).toBe(400);
  expect(bad.headers()['content-type']).toContain('application/problem+json');
  expect((await checkout(page.request, { pack_id: 'starter', provider: 'click' })).status()).toBe(
    404,
  );
  const made = await checkout(page.request, { pack_id: 'creator', provider: 'paddle' });
  expect(made.status()).toBe(201);
  const answer = (await made.json()) as {
    purchase_id: string;
    checkout: { kind: string; url: string };
  };
  expect(answer.checkout).toEqual({
    kind: 'redirect',
    url: `${ORIGIN}/credits/return?purchase=${answer.purchase_id}`,
  });
  const [pending] = await db.select().from(purchases).where(eq(purchases.id, answer.purchase_id));
  expect(pending).toMatchObject({
    userId: admin.id,
    provider: 'paddle',
    packId: 'creator',
    credits: 700,
    amountMinor: 1500,
    currency: 'USD',
    status: 'pending',
  });
  const view = await page.request.get(`/api/v1/credits/purchases/${answer.purchase_id}`);
  expect(await view.json()).toMatchObject({ status: 'pending', credits: 700, currency: 'USD' });

  // The website: a buyer finds "Buy credits", picks a pack and comes back to wait.
  const context = await browser.newContext();
  const buyer = await context.newPage();
  await signIn(buyer, newEmail());
  const me = (await (await buyer.request.get('/api/v1/me')).json()) as { buy_url: string | null };
  expect(me.buy_url).toBe(`${ORIGIN}/credits/buy`);
  await buyer.getByRole('link', { name: 'Buy credits' }).click();
  await expect(buyer.getByRole('heading', { name: 'Buy credits', level: 1 })).toBeVisible();
  await expect(buyer.getByText('$5.00')).toBeVisible();
  await buyer.getByRole('button', { name: /^Buy Starter/ }).click();
  await expect(buyer).toHaveURL(/\/credits\/return\?purchase=/);
  await expect(buyer.getByRole('heading', { name: 'Waiting for Paddle to confirm' })).toBeVisible();
  const purchaseId = new URL(buyer.url()).searchParams.get('purchase') ?? '';
  // Someone else can't see it.
  expect((await request.get(`/api/v1/credits/purchases/${purchaseId}`)).status()).toBe(401);
  expect(
    (await buyer.request.get(`/api/v1/credits/purchases/${answer.purchase_id}`)).status(),
  ).toBe(404);

  // The provider's server call: only with its key, then the credits arrive once.
  const hook = (key: string) =>
    request.post('/api/webhooks/paddle', {
      data: { purchase_id: purchaseId, action: 'complete' },
      headers: { Authorization: `Bearer ${key}` },
    });
  expect((await hook('wrong')).status()).toBe(401);
  expect((await hook(PAYMENTS_STUB_KEY)).status()).toBe(200);
  expect((await hook(PAYMENTS_STUB_KEY)).status()).toBe(200);
  await expect(buyer.getByRole('heading', { name: 'Credits added' })).toBeVisible({
    timeout: 15_000,
  });
  const [owner] = await db
    .select({ balance: users.creditBalance })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.userId))
    .where(eq(purchases.id, purchaseId));
  expect(owner?.balance).toBe(200);

  await buyer.getByRole('link', { name: 'Your account' }).click();
  const history = buyer.getByRole('region', { name: 'Your purchases' });
  await expect(history.getByRole('cell', { name: 'Paid' })).toBeVisible();
  await expect(history.getByRole('cell', { name: '$5.00' })).toBeVisible();

  // Switched off again: the links go, and the paths close at once.
  await allOff();
  await buyer.reload();
  await expect(buyer.getByRole('link', { name: 'Buy credits' })).toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Paid' })).toBeVisible();
  expect((await hook(PAYMENTS_STUB_KEY)).status()).toBe(404);
  await context.close();
});
