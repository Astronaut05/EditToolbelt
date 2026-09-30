/**
 * Accounts on the server build (docs/12 → M3 done-when: sign in, export and
 * delete an account). Sign-in links are read from the test outbox the server
 * writes to (MAIL_OUTBOX_DIR); the database is TEST_DATABASE_URL.
 */
import { readFileSync } from 'node:fs';

import { eq, sessions, users } from '@etb/db';
import { expect, test } from '@playwright/test';

import { askForLink, closeTestDb, linkFor, newEmail, signIn, testDb } from './helpers';

const db = testDb();

test.afterAll(async () => {
  await closeTestDb();
});

test('signs in with an email link, once, and keeps no IP or user agent', async ({ page }) => {
  const email = newEmail();
  await askForLink(page, email);
  const link = await linkFor(email);
  expect(link).toContain('/api/auth/magic-link/verify');
  await page.goto(link);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(email)).toBeVisible();
  // Signed in, the header offers the account, not sign-in.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Account' })).toBeVisible();

  const [user] = await db.select().from(users).where(eq(users.email, email));
  expect(user?.emailVerified).toBe(true);
  expect(user?.image).toBeNull();
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, user?.id ?? ''));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.ipAddress).toBeNull();
  expect(rows[0]?.userAgent).toBeNull();

  // The link works once.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?error=/);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'expired or was already used',
  );
});

test('the account pages are dynamic, uncached and nonce-protected', async ({ page }) => {
  const response = await page.goto('/sign-in');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response?.headers()['cache-control']).toContain('no-store');
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
  expect(violations).toEqual([]);
  // Signed out, the account sends you to sign in and back.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/sign-in\?next=\/account$/);
});

test('saves the profile and downloads the data as JSON', async ({ page }) => {
  const email = newEmail();
  await signIn(page, email);
  await page.getByLabel('Name (optional)').fill('Test Editor');
  await page.getByLabel(/Email me when new tools arrive/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Saved.');
  await expect(page.getByLabel('Name (optional)')).toHaveValue('Test Editor');

  const saved = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download my data' }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toMatch(/^edittoolbelt-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync(await file.path(), 'utf8')) as {
    profile: { email: string; displayName: string; marketingOptIn: boolean; creditBalance: number };
    signInMethods: { method: string }[];
    creditLedger: unknown[];
    jobs: { days: number; items: unknown[] };
    apiKeys: unknown[];
  };
  expect(data.profile).toMatchObject({
    email,
    displayName: 'Test Editor',
    marketingOptIn: true,
    creditBalance: 0,
  });
  expect(data.signInMethods).toEqual([{ method: 'email link' }]);
  expect(data.jobs.days).toBe(90);
  expect(JSON.stringify(data)).not.toMatch(/token|secret|password/i);
});

test('deletes the account, and signing in within 30 days restores it', async ({ page }) => {
  const email = newEmail();
  await signIn(page, email);
  await page.getByLabel(/to confirm/).fill('nope');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Nothing was deleted');

  await page.getByLabel(/to confirm/).fill('delete');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/sign-in\?deleted=1$/);
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Sign in within 30 days to restore it',
  );
  const [deleted] = await db.select().from(users).where(eq(users.email, email));
  expect(deleted?.deletedAt).not.toBeNull();
  expect(
    await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, deleted?.id ?? '')),
  ).toEqual([]);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page, email, 1);
  const [restored] = await db.select().from(users).where(eq(users.email, email));
  expect(restored?.id).toBe(deleted?.id);
  expect(restored?.deletedAt).toBeNull();
});

test('a disabled account gets no sign-in link', async ({ page }) => {
  const email = newEmail();
  await db.insert(users).values({ email, disabledAt: new Date() });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('This account is disabled');
});

test('health checks answer', async ({ request }) => {
  expect((await request.get('/healthz')).status()).toBe(200);
  const ready = await request.get('/readyz');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({ status: 'ready', checks: { database: true } });
});
