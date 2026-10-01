/**
 * The admin on the server build (docs/12 → M3 done-when: "flip any tool's
 * status from admin and see it change within 30 s"; docs/07, docs/11 → TOTP
 * and audit). Tests change `trim-video` and `crop-image`, so they run one at a
 * time and put the tools back.
 */
import AxeBuilder from '@axe-core/playwright';
import {
  adminAuditLog,
  alerts,
  and,
  applyCredit,
  creditTransactions,
  eq,
  jobs,
  systemChecks,
  toolFlags,
  uploads,
  users,
} from '@etb/db';
import { expect, test, type Page } from '@playwright/test';

import { closeTestDb, newEmail, signIn, testDb, totp } from './helpers';

const db = testDb();

// Tool status reaches every part of the server within 30 s, so some tests wait that long.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

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
  // A server action, a cache clear and a redirect: slower than one expect's 5 s in CI's Firefox.
  await expect(page).toHaveURL(/[?&]saved=1/, { timeout: 30_000 });
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
  // Another browser's run of this test may have left it off for up to 30 s.
  await expect
    .poll(async () => (await request.get('/trim-video')).status(), { timeout: 40_000 })
    .toBe(200);

  await saveTool(page, 'trim-video', async (p) => {
    await p.getByLabel('Status').selectOption('disabled');
  });
  // Within 30 s (docs/12): here at once, since the change clears the cache.
  await expect
    .poll(async () => (await request.get('/trim-video')).status(), { timeout: 30_000 })
    .toBe(404);
  const video = await (await request.get('/video')).text();
  expect(video).not.toContain('href="/trim-video"');
  // The API's routes keep their own copy of the flags (another bundle): within 30 s too.
  await expect
    .poll(
      async () => {
        const api = (await (await request.get('/api/v1/tools')).json()) as {
          tools: { id: string }[];
        };
        return api.tools.some((tool) => tool.id === 'trim-video');
      },
      { timeout: 40_000 },
    )
    .toBe(false);

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

test('an admin finds a job, cancels it with its credits back, and retries one', async ({
  page,
}) => {
  const admin = await becomeAdmin(page);
  const target = newEmail();
  const [user] = await db.insert(users).values({ email: target }).returning();
  if (!user) throw new Error('no user');
  await applyCredit(db, user.id, 'welcome_grant', 10);
  const [queued] = await db
    .insert(jobs)
    .values({
      toolId: 'compress-video',
      userId: user.id,
      source: 'web',
      funding: 'credits',
      creditsQuoted: 4,
      options: { mode: 'size', targetMb: 25 },
      inputMeta: { duration_ms: 240_000 },
    })
    .returning();
  if (!queued) throw new Error('no job');
  await applyCredit(db, user.id, 'reserve', -4, { jobId: queued.id });

  await page.goto(`/admin/jobs?user=${encodeURIComponent(target)}`);
  await expect(page.getByRole('region', { name: 'Jobs' }).getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('cell', { name: '4 credits' })).toBeVisible();
  await page.getByRole('region', { name: 'Jobs' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: `Job ${queued.id.slice(0, 8)}` })).toBeVisible();
  await expect(page.getByText('"targetMb": 25')).toBeVisible();
  await page.getByLabel('Reason (goes into the audit log)').fill('Stuck, support ticket');
  await page.getByRole('button', { name: 'Cancel and give the credits back' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Cancelled');
  const [after] = await db.select().from(users).where(eq(users.id, user.id));
  expect(after?.creditBalance).toBe(10);
  const [cancel] = await db
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.targetId, queued.id), eq(adminAuditLog.adminId, admin.id)));
  expect(cancel).toMatchObject({ action: 'job.cancel', reason: 'Stuck, support ticket' });

  // A failed job whose input is still there can run again, on us.
  const key = `in/${crypto.randomUUID()}`;
  await db.insert(uploads).values({
    userId: user.id,
    storageKey: key,
    bytes: 10,
    mimeClaimed: 'video/mp4',
    toolId: 'compress-video',
    partSize: 8 * 1024 * 1024,
    partCount: 1,
    expiresAt: new Date(Date.now() + 3_600_000),
    completedAt: new Date(),
  });
  const [failed] = await db
    .insert(jobs)
    .values({
      toolId: 'compress-video',
      userId: user.id,
      source: 'web',
      status: 'failed',
      errorCode: 'WORKER_LOST',
      attempts: 3,
      inputKey: key,
      funding: 'daily',
      finishedAt: new Date(),
    })
    .returning();
  if (!failed) throw new Error('no job');
  await page.goto(`/admin/jobs/${failed.id}`);
  await expect(page.getByText('WORKER_LOST')).toBeVisible();
  await page.getByLabel('Reason (goes into the audit log)').fill('Worker crash, rerun');
  await page.getByRole('button', { name: 'Run it again' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Back in the queue');
  const [rerun] = await db.select().from(jobs).where(eq(jobs.id, failed.id));
  expect(rerun).toMatchObject({ status: 'queued', attempts: 0, errorCode: null, funding: 'none' });
  // Leave nothing queued for other tests' workers.
  await db.update(jobs).set({ status: 'cancelled' }).where(eq(jobs.id, failed.id));
});

test('the signed-in pages pass axe, light and dark', async ({ page }) => {
  await becomeAdmin(page);
  // A table wider than the screen, so axe also checks one that scrolls sideways.
  await db
    .insert(systemChecks)
    .values({ name: 'e2e_wide_table', ok: true, detail: { note: 'x'.repeat(400) } })
    .onConflictDoNothing();
  const [user] = await db.insert(users).values({ email: newEmail() }).returning();
  if (!user) throw new Error('no user');
  const [job] = await db
    .insert(jobs)
    .values({
      toolId: 'compress-video',
      userId: user.id,
      source: 'web',
      status: 'failed',
      errorCode: 'TIMEOUT',
      options: { mode: 'quality', quality: 'high' },
      finishedAt: new Date(),
    })
    .returning();
  const paths = [
    '/account',
    '/admin',
    '/admin/tools',
    '/admin/tools/trim-video',
    '/admin/jobs',
    `/admin/jobs/${job?.id ?? ''}`,
    '/admin/users',
    `/admin/users/${user.id}`,
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

test('the system page lists the alerts the worker raised', async ({ page }) => {
  await becomeAdmin(page);
  const subject = `worker/e2e-${String(Date.now())}`;
  await db.insert(alerts).values({
    rule: 'heartbeat_missing',
    subject,
    message: `worker ${subject} last checked in 5 min ago.`,
    channels: ['email'],
  });
  await page.goto('/admin/system');
  const row = page.getByRole('row').filter({ hasText: subject }).first();
  await expect(row).toContainText('heartbeat_missing');
  await expect(row).toContainText('email');
});
