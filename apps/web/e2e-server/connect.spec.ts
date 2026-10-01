/**
 * The panel's connect flow (docs/06 → Auth): the `request` fixture plays the
 * panel (no cookies), the page plays the person approving at /connect.
 */
import AxeBuilder from '@axe-core/playwright';
import { deviceCodes, eq } from '@etb/db';
import { expect, test, type APIRequestContext } from '@playwright/test';

import { closeTestDb, linkFor, newEmail, signIn, testDb } from './helpers';

const db = testDb();

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await closeTestDb();
});

interface Started {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

async function start(panel: APIRequestContext): Promise<Started> {
  const answer = await panel.post('/api/v1/auth/device', { data: {} });
  expect(answer.status()).toBe(200);
  return (await answer.json()) as Started;
}

const poll = (panel: APIRequestContext, deviceCode: string) =>
  panel.post('/api/v1/auth/device/token', { data: { device_code: deviceCode } });

test('the panel gets a key once the person approves its code', async ({ page, request }) => {
  const started = await start(request);
  expect(started.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  expect(started.verification_uri).toMatch(/\/connect$/);
  expect(started.verification_uri_complete).toBe(
    `${started.verification_uri}?code=${started.user_code}`,
  );
  expect(started).toMatchObject({ expires_in: 600, interval: 5 });

  const waiting = await poll(request, started.device_code);
  expect(waiting.status()).toBe(400);
  expect(await waiting.json()).toMatchObject({ code: 'AUTHORIZATION_PENDING', interval: 5 });
  const tooFast = await poll(request, started.device_code);
  expect(await tooFast.json()).toMatchObject({ code: 'SLOW_DOWN', interval: 10 });

  // Signed out, the link goes through sign-in and comes back to the code.
  const email = newEmail();
  const link = new URL(started.verification_uri_complete);
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await page.goto(await linkFor(email));
  await expect(page).toHaveURL(new RegExp(`/connect\\?code=${started.user_code}$`));

  await expect(
    page.getByRole('heading', { name: `Connect “Premiere panel” to ${email}?` }),
  ).toBeVisible();
  await expect(page.getByText('Upload files and start jobs')).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(/Connected/);

  const collected = await poll(request, started.device_code);
  expect(collected.status()).toBe(200);
  const key = (await collected.json()) as { api_key: string; name: string; scopes: string[] };
  expect(key).toMatchObject({
    api_key: expect.stringMatching(/^etb_live_[0-9A-Za-z]{32}$/),
    name: 'Premiere panel',
    scopes: ['jobs:read', 'jobs:write', 'account:read'],
  });
  const me = await request.get('/api/v1/me', {
    headers: { Authorization: `Bearer ${key.api_key}` },
  });
  expect(await me.json()).toMatchObject({ email });

  // Collected once; the code is spent.
  expect(await (await poll(request, started.device_code)).json()).toMatchObject({
    code: 'EXPIRED_TOKEN',
  });
  await page.goto('/account#api-keys');
  await expect(page.getByRole('list', { name: 'Your API keys' })).toContainText('Premiere panel');
});

test('a typed code can be declined, and the panel is told', async ({ page, request }) => {
  const started = await start(request);
  await signIn(page, newEmail());
  await page.goto('/connect');
  await page
    .getByLabel('The code the panel shows')
    .fill(` ${started.user_code.toLowerCase().replace('-', ' ')} `);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('status')).toHaveText(/Declined/);
  const declined = await poll(request, started.device_code);
  expect(declined.status()).toBe(403);
  expect(await declined.json()).toMatchObject({ code: 'ACCESS_DENIED' });
});

test('an expired or made-up code goes nowhere', async ({ page, request }) => {
  const started = await start(request);
  await db
    .update(deviceCodes)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(deviceCodes.userCode, started.user_code.replace('-', '')));
  await signIn(page, newEmail());
  await page.goto(`/connect?code=${started.user_code}`);
  await expect(page.getByText(/That code is wrong or has expired/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  expect(await (await poll(request, started.device_code)).json()).toMatchObject({
    code: 'EXPIRED_TOKEN',
  });
  expect(await (await poll(request, 'x'.repeat(43))).json()).toMatchObject({
    code: 'EXPIRED_TOKEN',
  });
  await page.goto('/connect?code=BCDF-GHJK');
  await expect(page.getByText(/That code is wrong or has expired/)).toBeVisible();
});

test('/connect passes axe, light and dark', async ({ page, request }) => {
  const started = await start(request);
  await signIn(page, newEmail());
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/connect', `/connect?code=${started.user_code}`]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      for (const violation of results.violations) {
        if (violation.impact === 'serious' || violation.impact === 'critical') {
          found.push(`${scheme} ${path} ${violation.id}`);
        }
      }
    }
  }
  expect(found).toEqual([]);
});
