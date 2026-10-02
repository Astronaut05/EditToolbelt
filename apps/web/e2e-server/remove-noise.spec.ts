/**
 * A10 Noise Reduction on its page (tools/audio.md → A10): the free 10 s
 * preview, cut by the page and played A/B, then the whole file on our
 * servers, named after the original. The test plays the worker in the
 * database, as server-path.spec.ts does; the worker's own tests clean the
 * same fixture for real.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { and, desc, eq, isNotNull, jobs, uploads, users } from '@etb/db';
import { expect, test, type Page } from '@playwright/test';
import { AwsClient } from 'aws4fetch';

import { TEST_STORAGE } from '../scripts/server-env.ts';
import { closeTestDb, newEmail, signIn, testDb } from './helpers';

const db = testDb();
const NOISY = fileURLToPath(new URL('../../../fixtures/audio/noisy-speech.wav', import.meta.url));

const storage = new AwsClient({
  accessKeyId: TEST_STORAGE.S3_ACCESS_KEY_ID,
  secretAccessKey: TEST_STORAGE.S3_SECRET_ACCESS_KEY,
  service: 's3',
  region: TEST_STORAGE.S3_REGION,
});
const objectUrl = (key: string) => `${TEST_STORAGE.S3_ENDPOINT}/${TEST_STORAGE.S3_BUCKET}/${key}`;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.afterAll(async () => {
  await closeTestDb();
});

async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error('no such user');
  return row.id;
}

/** The worker's probe of the page's newest upload: a mono 48 kHz WAV this long. */
async function probeUpload(owner: string, durationMs: number): Promise<string> {
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
  const [row] = await db.select().from(uploads).where(eq(uploads.id, id));
  expect(row).toMatchObject({ mimeClaimed: 'audio/wav', toolId: 'remove-noise' });
  await db
    .update(uploads)
    .set({
      probe: {
        container: 'wav',
        duration_ms: durationMs,
        video: null,
        audio: { codec: 'pcm_s16le', sample_rate: 48000, channels: 1, bit_rate: 768000 },
      },
      probedAt: new Date(),
    })
    .where(eq(uploads.id, id));
  return id;
}

/** The newest job the page started, once there are `count` of them. */
async function newestJob(owner: string, count: number) {
  let found: (typeof jobs.$inferSelect)[] = [];
  await expect
    .poll(
      async () => {
        found = await db
          .select()
          .from(jobs)
          .where(and(eq(jobs.userId, owner), isNotNull(jobs.inputKey)))
          .orderBy(desc(jobs.createdAt));
        return found.length;
      },
      { timeout: 30_000 },
    )
    .toBe(count);
  const [job] = found;
  if (!job) throw new Error('no job');
  return job;
}

/** The worker's part: the job is done, with `body` as its WAV result. */
async function finish(id: string, body: Uint8Array<ArrayBuffer>, notes: string[]) {
  const outputKey = `out/${randomUUID()}`;
  await storage.fetch(objectUrl(outputKey), { method: 'PUT', body });
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      progress: 100,
      outputKey,
      outputMeta: { bytes: body.length, content_type: 'audio/wav', ext: 'wav', notes },
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, id));
  return outputKey;
}

async function dropNoisy(page: Page) {
  await page.goto('/remove-noise');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(NOISY);
  await expect(
    page.getByText('Noise reduction runs on our servers').filter({ visible: true }),
  ).toBeVisible({ timeout: 20_000 });
}

test('a free 10 s preview plays A/B, then the whole file is cleaned on our servers', async ({
  page,
}) => {
  const email = newEmail();
  await signIn(page, email);
  const owner = await userId(email);
  await dropNoisy(page);
  // No browser path: the run is on our servers, after a free preview.
  await expect(page.getByRole('button', { name: 'Clean', exact: true })).toHaveCount(0);
  const preview = page
    .getByRole('button', { name: 'Preview 10 s · free' })
    .filter({ visible: true });
  await expect(preview).toBeEnabled();
  await expect(
    page
      .getByText('Free: uses 1 of your free server jobs today (3 left).')
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.getByRole('radio', { name: '50 Hz' }).click();

  await preview.click();
  // The fixture is 6 s, so the snippet is all of it.
  await probeUpload(owner, 6000);
  const trial = await newestJob(owner, 1);
  expect(trial).toMatchObject({ toolId: 'remove-noise', funding: 'daily', creditsQuoted: 0 });
  expect(trial.options).toEqual({
    strength: 'medium',
    dehum: '50',
    deess: false,
    format: 'keep',
    preview: true,
  });
  const snippetKey = await finish(trial.id, readFileSync(NOISY), [
    'Medium: background noise down by up to 24 dB',
  ]);
  await expect(page.getByText('Preview · 0:00.0 to 0:06.0')).toBeVisible({ timeout: 20_000 });
  const listen = page.getByRole('radiogroup', { name: 'Listen to' });
  await expect(listen.getByRole('radio', { name: 'Cleaned' })).toBeChecked();
  await listen.getByRole('radio', { name: 'Original' }).click();
  await expect(page.getByText('You’re hearing the original.')).toBeVisible();
  await expect(page.getByText('Medium: background noise down by up to 24 dB')).toBeVisible();
  // A preview spent one of today's free jobs.
  await expect(
    page
      .getByText('Free: uses 1 of your free server jobs today (2 left).')
      .filter({ visible: true })
      .first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Clean on our servers', exact: true }).click();
  await probeUpload(owner, 6000);
  const job = await newestJob(owner, 2);
  expect(job).toMatchObject({ funding: 'daily', creditsQuoted: 0, timeoutSec: 3600 });
  expect(job.options).toMatchObject({ dehum: '50', format: 'keep', preview: false });
  const resultKey = await finish(job.id, readFileSync(NOISY), [
    'Same length as the original: 0:06.000',
  ]);
  const download = page.getByRole('button', { name: /^Download WAV/ });
  await expect(download).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText('Same length as the original: 0:06.000').first()).toBeAttached();
  const saved = page.waitForEvent('download');
  await download.click();
  expect((await saved).suggestedFilename()).toBe('noisy-speech_clean.wav');
  for (const key of [snippetKey, resultKey]) {
    await storage.fetch(objectUrl(key), { method: 'DELETE' });
  }
});
