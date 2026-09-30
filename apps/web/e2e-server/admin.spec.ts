/**
 * The admin on the server build (docs/12 → M3 done-when: "flip any tool's
 * status from admin and see it change within 30 s"; docs/07, docs/11 → TOTP
 * and audit). Tests change `trim-video` and `crop-image`, so they run one at a
 * time and put the tools back.
 */
import {
  adminAuditLog,
  and,
  creditTransactions,
  eq,
  systemChecks,
  toolFlags,
  users,
} from '@etb/db';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { closeTestDb, newEmail, signIn, testDb, totp } from './helpers';

const db = testDb();

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await db.delete(toolFlags).where(eq(toolFlags.toolId, 'trim-video'));
  await db.delete(toolFlags).where(eq(toolFlags.toolId, 'crop-image'));
  await closeTestDb();
});

/** Signs in a new account, makes it an admin and sets up TOTP; returns its id and the key. */
async function becomeAdmin(page: Page): Promise<{ id: string; key: string }> {
  const email = newEmail();
  await signIn(page, email);
  const [admin] = await db
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (!admin) throw new Error('no user');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/two-factor$/);
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const key = (await page.getByText(/^Key:/).innerText()).replace('Key:', '').trim();
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(10);
  await page.getByLabel('3. Enter the code the app shows').fill(totp(key));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Account' })).toBeVisible();
  return { id: admin.id, key };
}

async function saveTool(page: Page, id: string, fill: (page: Page) => Promise<void>) {
  await page.goto(`/admin/tools/${id}`);
  await fill(page);
  await page.getByLabel('Reason (goes into the audit log)').fill('End-to-end test');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Saved');
}

test('the admin is a 404 for anyone but an admin', async ({ page, request }) => {
  expect((await request.get('/admin')).status()).toBe(404);
  await signIn(page, newEmail());
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(404);
});

test('an admin passes TOTP, and a wrong code is refused', async ({ page, browser }) => {
  const { key } = await becomeAdmin(page);
  // Another browser with the same session but no step-up is sent to the code form.
  const cookies = (await page.context().cookies()).filter((c) => c.name !== 'etb.admin_2fa');
  const other = await browser.newContext();
  await other.addCookies(cookies);
  const second = await other.newPage();
  await second.goto('/admin/tools');
  await expect(second).toHaveURL(/\/admin\/two-factor$/);
  await second.getByLabel('Code', { exact: true }).fill('000000');
  await second.getByRole('button', { name: 'Continue' }).click();
  await expect(second.getByRole('main').getByRole('alert')).toContainText('didn’t work');
  await second.getByLabel('Code', { exact: true }).fill(totp(key));
  await second.getByRole('button', { name: 'Continue' }).click();
  await expect(second.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await other.close();
});

test('disabling a tool takes it off the site, and the default brings it back', async ({
  page,
  request,
}) => {
  const admin = await becomeAdmin(page);
  expect((await request.get('/trim-video')).status()).toBe(200);

  await saveTool(page, 'trim-video', async (p) => {
    await p.getByLabel('Status').selectOption('disabled');
  });
  // Within 30 s (docs/12): here at once, since the change clears the cache.
  await expect
    .poll(async () => (await request.get('/trim-video')).status(), { timeout: 30_000 })
    .toBe(404);
  const video = await (await request.get('/video')).text();
  expect(video).not.toContain('href="/trim-video"');
  const api = (await (await request.get('/api/v1/tools')).json()) as { tools: { id: string }[] };
  expect(api.tools.some((tool) => tool.id === 'trim-video')).toBe(false);

  await saveTool(page, 'trim-video', async (p) => {
    await p.getByLabel('Status').selectOption('default');
  });
  await expect
    .poll(async () => (await request.get('/trim-video')).status(), { timeout: 30_000 })
    .toBe(200);

  // This admin's first change; the database is shared with other tests, including packages/db's.
  const [entry] = await db
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.targetId, 'trim-video'), eq(adminAuditLog.adminId, admin.id)))
    .orderBy(adminAuditLog.id)
    .limit(1);
  expect(entry).toMatchObject({ action: 'tool.flags', reason: 'End-to-end test' });
});

test('a maintenance message shows on the tool page', async ({ page }) => {
  await becomeAdmin(page);
  await saveTool(page, 'crop-image', async (p) => {
    await p.getByLabel(/Maintenance message/).fill('Back in an hour.');
  });
  await page.goto('/crop-image');
  await expect(page.getByRole('note')).toContainText('Back in an hour.');
  await saveTool(page, 'crop-image', async (p) => {
    await p.getByLabel(/Maintenance message/).fill('');
  });
});

test('granting credits writes the ledger and the audit log', async ({ page }) => {
  await becomeAdmin(page);
  const target = newEmail();
  const [user] = await db.insert(users).values({ email: target }).returning();
  if (!user) throw new Error('no user');
  // Its own reason, so the audit log shows exactly one cell for it whatever else is there.
  const reason = `Support: goodwill ${user.id.slice(-8)}`;
  await page.goto(`/admin/users?q=${encodeURIComponent(target)}`);
  await page.getByRole('link', { name: target }).click();
  await page.getByLabel('Credits').fill('50');
  await page.getByLabel('Reason (goes into the audit log)').first().fill(reason);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Done');
  const [after] = await db.select().from(users).where(eq(users.id, user.id));
  expect(after?.creditBalance).toBe(50);
  const [row] = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, user.id));
  expect(row).toMatchObject({ kind: 'admin_grant', amount: 50, reason });
  await page.goto('/admin/audit');
  await expect(page.getByRole('cell', { name: reason })).toBeVisible();
});

test('the signed-in pages pass axe, light and dark', async ({ page }) => {
  await becomeAdmin(page);
  // A table wider than the screen, so axe also checks one that scrolls sideways.
  await db
    .insert(systemChecks)
    .values({ name: 'e2e_wide_table', ok: true, detail: { note: 'x'.repeat(400) } })
    .onConflictDoNothing();
  const [user] = await db.insert(users).values({ email: newEmail() }).returning();
  const paths = [
    '/account',
    '/admin',
    '/admin/tools',
    '/admin/tools/trim-video',
    '/admin/users',
    `/admin/users/${user?.id ?? ''}`,
    '/admin/audit',
    '/admin/system',
  ];
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of paths) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      for (const violation of results.violations) {
        if (violation.impact === 'serious' || violation.impact === 'critical') {
          const nodes = violation.nodes.map((node) => node.target.join(' ')).join(', ');
          found.push(`${scheme} ${path} ${violation.id}: ${nodes}`);
        }
      }
    }
  }
  expect(found).toEqual([]);
});
