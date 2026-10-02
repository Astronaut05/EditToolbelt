/**
 * The server path on a tool page (docs/02 → Routing; docs/12 → M4: "Hybrid
 * routing UI (server fallback offer with reason)"): the offer and its terms,
 * sign-in, the upload from the page, the server's price, live progress and
 * the result named after the original. The tests play the worker in the
 * database, as in jobs.spec.ts; the real worker runs in the stack.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  applyCredit,
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  jobs,
  toolFlags,
  uploads,
  users,
} from '@etb/db';
import { expect, test, type Page } from '@playwright/test';
import { AwsClient } from 'aws4fetch';

import { TEST_STORAGE } from '../scripts/server-env.ts';
import { closeTestDb, newEmail, signIn, testDb } from './helpers';

const db = testDb();
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/video/${name}`, import.meta.url));
const CLIP = fixture('clip-h264-aac.mp4');
const VFR_CLIP = fixture('clip-vfr.mp4');

const storage = new AwsClient({
  accessKeyId: TEST_STORAGE.S3_ACCESS_KEY_ID,
  secretAccessKey: TEST_STORAGE.S3_SECRET_ACCESS_KEY,
  service: 's3',
  region: TEST_STORAGE.S3_REGION,
});
const objectUrl = (key: string) => `${TEST_STORAGE.S3_ENDPOINT}/${TEST_STORAGE.S3_BUCKET}/${key}`;

// The first test waits for the page to pick up the server path (up to a minute).
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  await db
    .insert(toolFlags)
    .values({ toolId: 'compress-video', serverEnabled: true })
    .onConflictDoUpdate({ target: toolFlags.toolId, set: { serverEnabled: true } });
  // The server tools are beta in the registry; undo any status an earlier spec set.
  for (const toolId of ['vfr-to-cfr', 'burn-subtitles']) {
    await db
      .insert(toolFlags)
      .values({ toolId, status: 'beta' })
      .onConflictDoUpdate({ target: toolFlags.toolId, set: { status: 'beta' } });
  }
});

// The switches stay on (see jobs.spec.ts): the API's routes would see them go off late.
test.afterAll(async () => {
  await closeTestDb();
});

const offerLink = (page: Page) => page.getByRole('button', { name: 'Use our servers instead' });
const startButton = (page: Page) =>
  page.getByRole('button', { name: 'Compress on our servers', exact: true });

/** Drops the clip; the page shows the server path within 30 s of it being switched on. */
async function dropWithServer(page: Page) {
  await expect
    .poll(
      async () => {
        await page.goto('/compress-video');
        await page.locator('input[type=file][data-hydrated]').first().setInputFiles(CLIP);
        await expect(page.getByRole('button', { name: 'Compress', exact: true })).toBeVisible();
        return offerLink(page).isVisible();
      },
      { timeout: 90_000, intervals: [3000] },
    )
    .toBe(true);
  await offerLink(page).click();
}

async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error('no such user');
  return row.id;
}

/** The worker's probe: waits for the page's upload to complete, then records it. */
async function probeUpload(owner: string, durationMs: number, video: Record<string, unknown> = {}) {
  let id = '';
  await expect
    .poll(
      async () => {
        const [row] = await db
          .select()
          .from(uploads)
          .where(eq(uploads.userId, owner))
          .orderBy(desc(uploads.createdAt))
          .limit(1);
        id = row?.completedAt && !row.probedAt ? row.id : '';
        return id;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  await db
    .update(uploads)
    .set({
      probe: {
        container: 'mp4',
        duration_ms: durationMs,
        video: { codec: 'h264', width: 256, height: 144, fps: 30, ...video },
        audio: { codec: 'aac', channels: 2, sample_rate: 48000, bit_rate: 128000 },
      },
      probedAt: new Date(),
    })
    .where(eq(uploads.id, id));
  return id;
}

async function jobOf(owner: string) {
  let job: typeof jobs.$inferSelect | undefined;
  await expect
    .poll(
      async () => {
        [job] = await db
          .select()
          .from(jobs)
          // A job the page started has an input; the ones a test made up don't.
          .where(and(eq(jobs.userId, owner), isNotNull(jobs.inputKey)))
          .orderBy(desc(jobs.createdAt))
          .limit(1);
        return job?.id ?? '';
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  if (!job) throw new Error('no job');
  return job;
}

test('signed out, the offer says why and asks to sign in first', async ({ page }) => {
  await dropWithServer(page);
  const notice = page.getByRole('status').filter({ hasText: 'Our servers', visible: true });
  await expect(notice).toContainText('You chose our servers');
  await expect(notice).toContainText('Server processing needs an account');
  await expect(notice.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/sign-in?next=%2Fcompress-video',
  );
  await expect(startButton(page)).toBeDisabled();
});

test('a free server job: upload, live progress, and the result named after the original', async ({
  page,
}) => {
  const email = newEmail();
  await signIn(page, email);
  const owner = await userId(email);
  await dropWithServer(page);
  await expect(
    page
      .getByText('Free: uses 1 of your free server jobs today (3 left).')
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Size' }).selectOption('10');
  await startButton(page).click();

  await probeUpload(owner, 30_000);
  const job = await jobOf(owner);
  expect(job).toMatchObject({ funding: 'daily', status: 'queued', creditsQuoted: 0 });
  expect(job.options).toMatchObject({ mode: 'size', targetMb: 10, codec: 'h264', audio: 'keep' });

  // The worker's part.
  await db
    .update(jobs)
    .set({ status: 'running', progress: 60, stage: 'compressing', startedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await expect(page.getByText('Compressing').filter({ visible: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  const output = readFileSync(CLIP).subarray(0, 50_000);
  const outputKey = `out/${randomUUID()}`;
  await storage.fetch(objectUrl(outputKey), { method: 'PUT', body: output });
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      progress: 100,
      outputKey,
      outputMeta: {
        bytes: output.length,
        content_type: 'video/mp4',
        ext: 'mp4',
        width: 256,
        height: 144,
        notes: ['Saved in 8-bit colour so it plays everywhere'],
      },
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));

  const download = page.getByRole('button', { name: /^Download MP4/ });
  await expect(download).toBeEnabled({ timeout: 20_000 });
  await expect(
    page.getByText('Saved in 8-bit colour so it plays everywhere').first(),
  ).toBeAttached();
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('clip-h264-aac_compressed.mp4');
  expect(readFileSync(await file.path()).equals(output)).toBe(true);
  await storage.fetch(objectUrl(outputKey), { method: 'DELETE' });
});

test('a price that differs from the offer is asked again; declining uploads nothing more', async ({
  page,
}) => {
  const email = newEmail();
  await signIn(page, email);
  const owner = await userId(email);
  for (let i = 0; i < 3; i += 1) {
    await db.insert(jobs).values({
      toolId: 'compress-video',
      userId: owner,
      source: 'web',
      status: 'succeeded',
      funding: 'daily',
    });
  }
  await applyCredit(db, owner, 'welcome_grant', 10);
  await dropWithServer(page);
  // 30 s of video: the 2-credit minimum.
  await expect(
    page.getByText('About 2 credits; you have 10.').filter({ visible: true }),
  ).toBeVisible();

  await startButton(page).click();
  const declined = await probeUpload(owner, 4 * 60_000);
  const dialog = page.getByRole('dialog', { name: 'Confirm the price' });
  await expect(dialog).toContainText('this costs 4 credits. You have 10.');
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(startButton(page)).toBeEnabled();
  await expect
    .poll(async () => {
      const [row] = await db.select().from(uploads).where(eq(uploads.id, declined));
      return row?.deletedAt ?? null;
    })
    .not.toBeNull();

  await startButton(page).click();
  await probeUpload(owner, 4 * 60_000);
  await dialog.getByRole('button', { name: 'Start · 4 credits' }).click();
  const job = await jobOf(owner);
  expect(job).toMatchObject({ funding: 'credits', creditsQuoted: 4 });
  const [after] = await db.select().from(users).where(eq(users.id, owner));
  expect(after?.creditBalance).toBe(6);

  // The worker gives up: the page says why, and that the credits came back.
  await db
    .update(jobs)
    .set({ status: 'failed', errorCode: 'TIMEOUT', finishedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await applyCredit(db, owner, 'release', 4, { jobId: job.id });
  await expect(page.getByRole('alert').filter({ hasText: 'Couldn' })).toContainText(
    'It took too long and was stopped. Credits returned.',
  );
});

/** Opens a server tool once its status is set (the page catches up within 30 s) and drops a file. */
async function dropOnServerTool(page: Page, path: string, file: string) {
  const start = page.getByRole('button', { name: 'Convert on our servers', exact: true });
  await expect
    .poll(
      async () => {
        await page.goto(path);
        const input = page.locator('input[type=file][data-hydrated]').first();
        if ((await input.count()) === 0) return false;
        await input.setInputFiles(file);
        await expect(page.getByText('Precise frame timing needs ffmpeg').first()).toBeAttached();
        return start.isVisible();
      },
      { timeout: 90_000, intervals: [3000] },
    )
    .toBe(true);
  return start;
}

test('VFR to CFR runs only on our servers and fixes a phone clip', async ({ page }) => {
  const email = newEmail();
  await signIn(page, email);
  const owner = await userId(email);
  const start = await dropOnServerTool(page, '/vfr-to-cfr', VFR_CLIP);
  // No browser path: no Convert button of its own, no "instead" link.
  await expect(page.getByRole('button', { name: 'Convert', exact: true })).toHaveCount(0);
  await expect(offerLink(page)).toHaveCount(0);
  await expect(
    page
      .getByText('Free: uses 1 of your free server jobs today (3 left).')
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Frame rate' }).selectOption('25');
  await start.click();

  await probeUpload(owner, 4083, { fps: 29.39, vfr: true, maybe_vfr: true });
  const job = await jobOf(owner);
  expect(job).toMatchObject({ toolId: 'vfr-to-cfr', funding: 'daily', timeoutSec: 7200 });
  expect(job.options).toEqual({ fps: '25', quality: 'best', audio: 'keep' });

  const output = readFileSync(VFR_CLIP);
  const outputKey = `out/${randomUUID()}`;
  await storage.fetch(objectUrl(outputKey), { method: 'PUT', body: output });
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      progress: 100,
      outputKey,
      outputMeta: {
        bytes: output.length,
        content_type: 'video/mp4',
        ext: 'mp4',
        notes: ['Constant 25 fps'],
      },
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
  const download = page.getByRole('button', { name: /^Download MP4/ });
  await expect(download).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText('Constant 25 fps').first()).toBeAttached();
  const saved = page.waitForEvent('download');
  await download.click();
  expect((await saved).suggestedFilename()).toBe('clip-vfr_cfr.mp4');
  await storage.fetch(objectUrl(outputKey), { method: 'DELETE' });
});

test('a clip that is already constant is checked, and nothing is charged', async ({ page }) => {
  const email = newEmail();
  await signIn(page, email);
  const owner = await userId(email);
  const start = await dropOnServerTool(page, '/vfr-to-cfr', CLIP);
  await expect(page.getByText(/It looks constant already \(30 fps\)/).first()).toBeAttached();
  await start.click();
  const upload = await probeUpload(owner, 30_000, { vfr: false, maybe_vfr: false });
  await expect(page.getByRole('alert').filter({ hasText: 'Nothing to fix' })).toContainText(
    'This video already has a constant frame rate (30.00 fps)',
  );
  const [made] = await db.select({ n: count() }).from(jobs).where(eq(jobs.userId, owner));
  expect(made?.n).toBe(0);
  // The upload goes at once; it was never needed.
  await expect
    .poll(async () => {
      const [row] = await db.select().from(uploads).where(eq(uploads.id, upload));
      return row?.deletedAt ?? null;
    })
    .not.toBeNull();
});

test('Burn Subtitles uploads the subtitle file beside the video', async ({ page }) => {
  const email = newEmail();
  await signIn(page, email);
  const owner = await userId(email);
  const start = page.getByRole('button', { name: 'Burn on our servers', exact: true });
  await expect
    .poll(
      async () => {
        await page.goto('/burn-subtitles');
        const input = page.locator('input[type=file][data-hydrated]').first();
        if ((await input.count()) === 0) return false;
        await input.setInputFiles(CLIP);
        // The offer shows once the clip is read, which takes a moment longer in some browsers.
        return start.waitFor({ timeout: 15_000 }).then(
          () => true,
          () => false,
        );
      },
      { timeout: 90_000, intervals: [3000] },
    )
    .toBe(true);
  // Not before the subtitle file is in.
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole('status').filter({ hasText: 'Choose the subtitle file' }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Settings' })
    .locator('input[type=file][accept=".srt,.vtt,.ass,.ssa"]')
    .setInputFiles({
      name: 'clip.srt',
      mimeType: '',
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n'),
    });
  await expect(page.getByText('clip.srt').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Top' }).click();
  await start.click();

  // The worker's probe, for both files once both are in.
  let ids: string[] = [];
  await expect
    .poll(
      async () => {
        const rows = await db
          .select()
          .from(uploads)
          .where(and(eq(uploads.userId, owner), isNotNull(uploads.completedAt)));
        ids = rows.filter((row) => !row.probedAt).map((row) => row.id);
        return rows.length;
      },
      { timeout: 30_000 },
    )
    .toBe(2);
  for (const row of await db.select().from(uploads).where(inArray(uploads.id, ids))) {
    await db
      .update(uploads)
      .set({
        probe:
          row.mimeClaimed === 'application/x-subrip'
            ? { container: 'srt', subtitle: { codec: 'subrip' }, video: null, audio: null }
            : { container: 'mp4', duration_ms: 30_000, video: { width: 256, height: 144 } },
        probedAt: new Date(),
      })
      .where(eq(uploads.id, row.id));
  }
  const job = await jobOf(owner);
  expect(job.toolId).toBe('burn-subtitles');
  expect(job.extraInputKeys).toHaveLength(1);
  expect(job.options).toMatchObject({ position: 'top', font: 'sans', box: false });
  const [subtitles] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.storageKey, job.extraInputKeys[0] ?? ''));
  expect(subtitles).toMatchObject({ mimeClaimed: 'application/x-subrip', bytes: 38 });
  expect(job.options).toMatchObject({ subtitles: subtitles?.id });
  await db.update(jobs).set({ status: 'cancelled' }).where(eq(jobs.id, job.id));
});
