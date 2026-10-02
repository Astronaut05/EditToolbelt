/**
 * Server jobs over the API (docs/12 → M4: "Credits reserve → capture/release
 * wired", "free-tier daily allowance", "per-user concurrency caps"; docs/06).
 * The worker is played by these tests: they write the probe and the job's
 * progress straight to the database, as the worker would, and put the output
 * in storage. Compress Video's server path is switched on for this file; it
 * costs 1 credit a minute, at least 2.
 */
import { randomUUID } from 'node:crypto';

import { and, applyCredit, creditTransactions, eq, jobs, toolFlags, uploads, users } from '@etb/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { AwsClient } from 'aws4fetch';

import { SERVER_PORT, TEST_STORAGE } from '../scripts/server-env.ts';
import { closeTestDb, newEmail, signIn, testDb } from './helpers';

const db = testDb();
const ORIGIN = `http://localhost:${String(SERVER_PORT)}`;
const MINUTE = 60_000;

const storage = new AwsClient({
  accessKeyId: TEST_STORAGE.S3_ACCESS_KEY_ID,
  secretAccessKey: TEST_STORAGE.S3_SECRET_ACCESS_KEY,
  service: 's3',
  region: TEST_STORAGE.S3_REGION,
});
const objectUrl = (key: string) => `${TEST_STORAGE.S3_ENDPOINT}/${TEST_STORAGE.S3_BUCKET}/${key}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await db
    .insert(toolFlags)
    .values({ toolId: 'compress-video', serverEnabled: true })
    .onConflictDoUpdate({ target: toolFlags.toolId, set: { serverEnabled: true } });
  await db
    .insert(toolFlags)
    .values({ toolId: 'burn-subtitles', status: 'beta' })
    .onConflictDoUpdate({ target: toolFlags.toolId, set: { status: 'beta' } });
});

// The switches stay on: the API's routes see a change within 30 s, so turning
// them off here could leave the next spec, or the next browser's run, a step behind.
test.afterAll(async () => {
  await closeTestDb();
});

async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error('no such user');
  return row.id;
}

interface Probed {
  durationMs?: number;
  probed?: boolean;
  /** Another tool's upload, or a subtitle file. */
  tool?: string;
  subtitles?: boolean;
  probeError?: string;
  /** Put a small object at the upload's key, as a real upload would. */
  stored?: boolean;
}

/** A completed upload, probed as the worker would probe it. */
async function upload(owner: string, probe: Probed = {}): Promise<{ id: string; key: string }> {
  const key = `in/${randomUUID()}`;
  if (probe.stored) {
    const put = await storage.fetch(objectUrl(key), { method: 'PUT', body: 'not really a video' });
    expect(put.ok).toBe(true);
  }
  const probed = probe.probed ?? true;
  const [row] = await db
    .insert(uploads)
    .values({
      userId: owner,
      storageKey: key,
      bytes: 18,
      mimeClaimed: probe.subtitles ? 'application/x-subrip' : 'video/mp4',
      toolId: probe.tool ?? 'compress-video',
      partSize: 8 * 1024 * 1024,
      partCount: 1,
      expiresAt: new Date(Date.now() + 60 * MINUTE),
      completedAt: new Date(),
      probe: !probed
        ? null
        : probe.subtitles
          ? { container: 'srt', subtitle: { codec: 'subrip' }, video: null, audio: null }
          : {
              container: 'mp4',
              duration_ms: probe.durationMs ?? 90_000,
              video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
            },
      probedAt: probed ? new Date() : null,
      probeError: probe.probeError ?? null,
    })
    .returning();
  if (!row) throw new Error('upload not written');
  return { id: row.id, key };
}

const OPTIONS = { mode: 'size', targetMb: 10 };

function post(request: APIRequestContext, path: string, data: unknown, headers = {}) {
  return request.post(path, { data, headers: { Origin: ORIGIN, ...headers } });
}

function quote(request: APIRequestContext, uploadId: string, options: unknown = OPTIONS) {
  return post(request, '/api/v1/jobs/quote', {
    tool_id: 'compress-video',
    upload_id: uploadId,
    options,
  });
}

function create(
  request: APIRequestContext,
  uploadId: string,
  credits: number,
  key?: string,
  funding?: 'daily' | 'credits' | 'none',
) {
  return post(
    request,
    '/api/v1/jobs',
    {
      tool_id: 'compress-video',
      upload_id: uploadId,
      options: OPTIONS,
      quote_credits: credits,
      ...(funding && { quote_funding: funding }),
    },
    key ? { 'Idempotency-Key': key } : {},
  );
}

interface JobBody {
  job: {
    id: string;
    status: string;
    funding: string;
    credits_quoted: number;
    position: number | null;
    error: { code: string; credits_returned: boolean } | null;
    result: { download_url: string; bytes: number; ext: string; expires_at: string } | null;
  };
}

/** Signs in a new account and waits out the 30 s flag cache for the server path. */
async function newUser(page: Page): Promise<string> {
  const email = newEmail();
  await signIn(page, email);
  const id = await userId(email);
  const probe = await upload(id);
  await expect
    .poll(async () => (await quote(page.request, probe.id)).status(), {
      timeout: 40_000,
      intervals: [1000],
    })
    .toBe(200);
  return id;
}

test('quotes and jobs need an account, our own origin and a server tool', async ({
  page,
  request,
}) => {
  const anonymous = await quote(request, randomUUID());
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toMatchObject({ code: 'UNAUTHORIZED' });

  const owner = await newUser(page);
  const mine = await upload(owner);
  const foreign = await page.request.post('/api/v1/jobs/quote', {
    data: { tool_id: 'compress-video', upload_id: mine.id, options: OPTIONS },
    headers: { Origin: 'https://evil.example' },
  });
  expect(foreign.status()).toBe(403);

  const browserOnly = await post(page.request, '/api/v1/jobs/quote', {
    tool_id: 'trim-video',
    upload_id: mine.id,
  });
  expect(await browserOnly.json()).toMatchObject({ code: 'TOOL_UNAVAILABLE', status: 409 });

  const badOptions = await quote(page.request, mine.id, { mode: 'size' });
  expect(badOptions.status()).toBe(400);
  expect(await badOptions.json()).toMatchObject({ code: 'BAD_REQUEST', detail: /targetMb/ });

  const unknownOption = await quote(page.request, mine.id, { ...OPTIONS, crf: 18 });
  expect(unknownOption.status()).toBe(400);
});

test('the quote comes from the probe: price, what pays, and the limits', async ({ page }) => {
  const owner = await newUser(page);

  const short = await upload(owner, { durationMs: 90_000 });
  expect(await (await quote(page.request, short.id)).json()).toMatchObject({
    status: 'ready',
    credits: 2, // 1.5 min rounds up, and 2 is the minimum
    funding: 'daily',
    can_start: true,
    free_jobs_left: 3,
    balance: 0,
    balance_after: 0,
    options: {
      mode: 'size',
      targetMb: 10,
      resolution: 'auto',
      fps: 'keep',
      codec: 'h264',
      audio: 'keep',
    },
  });

  const long = await upload(owner, { durationMs: 12.2 * MINUTE });
  expect(await (await quote(page.request, long.id)).json()).toMatchObject({ credits: 13 });

  const tooLong = await upload(owner, { durationMs: 61 * MINUTE });
  const refused = await quote(page.request, tooLong.id);
  expect(refused.status()).toBe(413);
  expect(await refused.json()).toMatchObject({ code: 'FILE_TOO_LARGE', max_duration_sec: 3600 });

  const broken = await upload(owner, { probeError: 'UNSUPPORTED_FORMAT' });
  const unreadable = await quote(page.request, broken.id);
  expect(unreadable.status()).toBe(422);
  expect(await unreadable.json()).toMatchObject({ code: 'UNSUPPORTED_FORMAT' });

  // The quote waits a few seconds for the probe, then says it is still checking.
  const late = await upload(owner, { probed: false });
  const answer = quote(page.request, late.id);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await db
    .update(uploads)
    .set({ probe: { duration_ms: 3 * MINUTE }, probedAt: new Date() })
    .where(eq(uploads.id, late.id));
  expect(await (await answer).json()).toMatchObject({ status: 'ready', credits: 3 });

  const never = await upload(owner, { probed: false });
  const waiting = await quote(page.request, never.id);
  expect(waiting.status()).toBe(202);
  expect(waiting.headers()['retry-after']).toBe('1');
  expect(await waiting.json()).toEqual({ status: 'probing' });
});

test('a job starts at the quoted price, once per Idempotency-Key, once per upload', async ({
  page,
}) => {
  const owner = await newUser(page);
  const file = await upload(owner);

  const stale = await create(page.request, file.id, 5);
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'CONFLICT', credits: 2 });

  const key = randomUUID();
  const first = await create(page.request, file.id, 2, key);
  expect(first.status()).toBe(201);
  const { job } = (await first.json()) as JobBody;
  expect(job).toMatchObject({ status: 'queued', funding: 'daily', credits_quoted: 0 });
  expect(job.position).toBeGreaterThanOrEqual(0);

  const again = await create(page.request, file.id, 2, key);
  expect(again.status()).toBe(200);
  expect(((await again.json()) as JobBody).job.id).toBe(job.id);

  const twice = await create(page.request, file.id, 2, randomUUID());
  expect(await twice.json()).toMatchObject({ code: 'CONFLICT', status: 409 });

  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  expect(row).toMatchObject({
    userId: owner,
    toolId: 'compress-video',
    inputKey: file.key,
    priority: 0,
    timeoutSec: 7200,
    maxConcurrent: 2,
    options: {
      mode: 'size',
      targetMb: 10,
      resolution: 'auto',
      fps: 'keep',
      codec: 'h264',
      audio: 'keep',
    },
  });
  expect(row?.inputMeta).toMatchObject({ duration_ms: 90_000 });

  const listed = (await (await page.request.get('/api/v1/jobs')).json()) as {
    jobs: { id: string }[];
  };
  expect(listed.jobs.map((item) => item.id)).toEqual([job.id]);
});

test('a job quoted as a free daily job never takes credits unasked', async ({ page }) => {
  const owner = await newUser(page);
  // Two of today's three free jobs used, and credits on the account.
  for (const status of ['succeeded', 'succeeded'] as const) {
    const file = await upload(owner);
    await db.insert(jobs).values({
      toolId: 'compress-video',
      userId: owner,
      source: 'web',
      status,
      funding: 'daily',
      inputKey: file.key,
    });
  }
  await applyCredit(db, owner, 'admin_grant', 30, { adminId: owner, reason: 'e2e: two clips' });
  const first = await upload(owner, { durationMs: 2 * MINUTE });
  const second = await upload(owner, { durationMs: 2 * MINUTE });
  // Both quotes say "one of today's free jobs".
  for (const file of [first, second]) {
    expect(await (await quote(page.request, file.id)).json()).toMatchObject({
      credits: 2,
      funding: 'daily',
      free_jobs_left: 1,
    });
  }
  const one = await create(page.request, first.id, 2, undefined, 'daily');
  expect(one.status()).toBe(201);
  expect(((await one.json()) as JobBody).job).toMatchObject({ funding: 'daily' });

  // The last free job is gone: same price, but credits would pay. Refused, nothing reserved.
  const refused = await create(page.request, second.id, 2, undefined, 'daily');
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({
    code: 'CONFLICT',
    credits: 2,
    funding: 'credits',
    free_jobs_left: 0,
  });
  const balance = async () =>
    (await db.select().from(users).where(eq(users.id, owner)))[0]?.creditBalance;
  expect(await balance()).toBe(30);

  // A new quote says so; confirmed, it takes the credits.
  expect(await (await quote(page.request, second.id)).json()).toMatchObject({
    funding: 'credits',
    balance_after: 28,
  });
  const two = await create(page.request, second.id, 2, undefined, 'credits');
  expect(two.status()).toBe(201);
  expect(((await two.json()) as JobBody).job).toMatchObject({
    funding: 'credits',
    credits_quoted: 2,
  });
  expect(await balance()).toBe(28);
});

test('three free jobs a day, then credits: reserved, and released on cancel', async ({ page }) => {
  const owner = await newUser(page);
  for (const status of ['succeeded', 'succeeded', 'running'] as const) {
    const file = await upload(owner);
    await db.insert(jobs).values({
      toolId: 'compress-video',
      userId: owner,
      source: 'web',
      status,
      funding: 'daily',
      inputKey: file.key,
    });
  }

  const file = await upload(owner, { durationMs: 4 * MINUTE, stored: true });
  expect(await (await quote(page.request, file.id)).json()).toMatchObject({
    credits: 4,
    funding: 'credits',
    can_start: false,
    blocked_by: 'QUOTA_EXCEEDED',
    free_jobs_left: 0,
  });
  const refused = await create(page.request, file.id, 4);
  expect(refused.status()).toBe(429);
  expect(await refused.json()).toMatchObject({ code: 'QUOTA_EXCEEDED' });

  await applyCredit(db, owner, 'welcome_grant', 10);
  expect(await (await quote(page.request, file.id)).json()).toMatchObject({
    funding: 'credits',
    can_start: true,
    balance: 10,
    balance_after: 6,
  });
  const created = await create(page.request, file.id, 4);
  expect(created.status()).toBe(201);
  const { job } = (await created.json()) as JobBody;
  expect(job).toMatchObject({ funding: 'credits', credits_quoted: 4 });
  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  expect(row?.priority).toBe(1);
  const balance = async () =>
    (await db.select().from(users).where(eq(users.id, owner)))[0]?.creditBalance;
  expect(await balance()).toBe(6);

  const cancel = await post(page.request, `/api/v1/jobs/${job.id}/cancel`, {});
  expect(((await cancel.json()) as JobBody).job.status).toBe('cancelled');
  expect(await balance()).toBe(10);
  const ledger = await db
    .select({ kind: creditTransactions.kind, amount: creditTransactions.amount })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, owner), eq(creditTransactions.jobId, job.id)));
  expect(ledger).toEqual([
    { kind: 'reserve', amount: -4 },
    { kind: 'release', amount: 4 },
  ]);
  // A queued job's input goes when it's cancelled.
  expect((await storage.fetch(objectUrl(file.key), { method: 'HEAD' })).status).toBe(404);
  const [gone] = await db.select().from(uploads).where(eq(uploads.id, file.id));
  expect(gone?.deletedAt).not.toBeNull();

  // Cancelling again changes nothing.
  const twice = await post(page.request, `/api/v1/jobs/${job.id}/cancel`, {});
  expect(((await twice.json()) as JobBody).job.status).toBe('cancelled');
  expect(await balance()).toBe(10);

  // A free job that failed gives its slot back.
  await db
    .update(jobs)
    .set({ status: 'failed', errorCode: 'TIMEOUT' })
    .where(and(eq(jobs.userId, owner), eq(jobs.status, 'running')));
  const retry = await upload(owner);
  expect(await (await quote(page.request, retry.id)).json()).toMatchObject({
    funding: 'daily',
    free_jobs_left: 1,
  });
});

test('two jobs wait or run at once per free account', async ({ page }) => {
  const owner = await newUser(page);
  const started: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const response = await create(page.request, (await upload(owner)).id, 2);
    expect(response.status()).toBe(201);
    started.push(((await response.json()) as JobBody).job.id);
  }
  const third = await upload(owner);
  const busy = await create(page.request, third.id, 2);
  expect(busy.status()).toBe(429);
  expect(await busy.json()).toMatchObject({ code: 'RATE_LIMITED' });

  await post(page.request, `/api/v1/jobs/${started[0] ?? ''}/cancel`, {});
  expect((await create(page.request, third.id, 2)).status()).toBe(201);
});

test('progress streams to the page, then the result downloads', async ({ page, browser }) => {
  const owner = await newUser(page);
  const created = await create(page.request, (await upload(owner, { stored: true })).id, 2);
  const { job } = (await created.json()) as JobBody;

  const events = page.evaluate(
    (id) =>
      new Promise<{ seen: unknown[]; done: JobBody['job'] }>((resolve, reject) => {
        const seen: unknown[] = [];
        const source = new EventSource(`/api/v1/jobs/${id}/events`);
        source.addEventListener('progress', (event) => {
          seen.push(JSON.parse((event as MessageEvent<string>).data));
        });
        source.addEventListener('done', (event) => {
          source.close();
          resolve({
            seen,
            done: JSON.parse((event as MessageEvent<string>).data) as JobBody['job'],
          });
        });
        setTimeout(() => {
          source.close();
          reject(new Error(`no done event; saw ${JSON.stringify(seen)}`));
        }, 20_000);
      }),
    job.id,
  );

  // The worker's part.
  const step = () => new Promise((resolve) => setTimeout(resolve, 1500));
  await step();
  await db
    .update(jobs)
    .set({ status: 'running', progress: 40, stage: 'encoding', startedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await step();
  await db.update(jobs).set({ progress: 80 }).where(eq(jobs.id, job.id));
  await step();
  const outputKey = `out/${randomUUID()}`;
  const output = 'a smaller video';
  await storage.fetch(objectUrl(outputKey), { method: 'PUT', body: output });
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      progress: 100,
      outputKey,
      outputMeta: { bytes: output.length, content_type: 'video/mp4', ext: 'mp4' },
      finishedAt: new Date(),
      inputKey: null,
    })
    .where(eq(jobs.id, job.id));

  const { seen, done } = await events;
  expect(seen[0]).toMatchObject({ status: 'queued', progress: 0 });
  expect(seen).toContainEqual({
    status: 'running',
    progress: 40,
    stage: 'encoding',
    position: null,
  });
  expect(seen).toContainEqual({
    status: 'running',
    progress: 80,
    stage: 'encoding',
    position: null,
  });
  expect(done).toMatchObject({ status: 'succeeded', error: null });
  expect(done.result).toMatchObject({ bytes: output.length, ext: 'mp4' });
  expect(Date.parse(done.result?.expires_at ?? '') - Date.now()).toBeGreaterThan(55 * MINUTE);

  const download = await fetch(done.result?.download_url ?? '');
  expect(download.status).toBe(200);
  expect(await download.text()).toBe(output);
  expect(download.headers.get('content-disposition')).toContain('compress-video.mp4');

  // Someone else sees no such job.
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await signIn(stranger, newEmail());
  expect((await stranger.request.get(`/api/v1/jobs/${job.id}`)).status()).toBe(404);
  expect((await stranger.request.get(`/api/v1/jobs/${job.id}/events`)).status()).toBe(404);
  const cancel = await post(stranger.request, `/api/v1/jobs/${job.id}/cancel`, {});
  expect(cancel.status()).toBe(404);
  await other.close();
  await storage.fetch(objectUrl(outputKey), { method: 'DELETE' });
});

test('Burn Subtitles takes the subtitle file as its own upload, beside the video', async ({
  page,
  browser,
}) => {
  const owner = await newUser(page);
  const video = await upload(owner, { tool: 'burn-subtitles', durationMs: 3 * MINUTE });
  const subs = await upload(owner, { tool: 'burn-subtitles', subtitles: true });
  const burn = (uploadId: string, options: unknown, path = '/api/v1/jobs/quote', extra = {}) =>
    post(page.request, path, {
      tool_id: 'burn-subtitles',
      upload_id: uploadId,
      options,
      ...extra,
    });

  expect(await (await burn(video.id, { subtitles: subs.id, size: 'large' })).json()).toMatchObject({
    status: 'ready',
    credits: 3,
    options: { subtitles: subs.id, size: 'large', font: 'sans', box: false },
  });
  // The subtitles can't be the video, and the video can't be the subtitles.
  expect(await (await burn(subs.id, { subtitles: video.id })).json()).toMatchObject({
    code: 'BAD_REQUEST',
    title: 'The video goes first',
  });
  const other = await upload(owner, { tool: 'burn-subtitles' });
  expect(await (await burn(video.id, { subtitles: other.id })).json()).toMatchObject({
    code: 'BAD_REQUEST',
    title: 'Not a subtitle file',
  });
  expect((await burn(video.id, {})).status()).toBe(400);

  const created = await burn(video.id, { subtitles: subs.id }, '/api/v1/jobs', {
    quote_credits: 3,
  });
  expect(created.status()).toBe(201);
  const { job } = (await created.json()) as JobBody;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  expect(row?.extraInputKeys).toEqual([subs.key]);
  expect(row?.inputMeta).toMatchObject({ extras: [{ container: 'srt' }] });

  // One job per subtitle file too.
  const again = await upload(owner, { tool: 'burn-subtitles' });
  expect(await (await burn(again.id, { subtitles: subs.id })).json()).toMatchObject({
    code: 'CONFLICT',
  });
  // Someone else's subtitle file is no file at all.
  const other2 = await browser.newContext();
  const stranger = await other2.newPage();
  const strangerId = await newUser(stranger);
  const theirs = await upload(strangerId, { tool: 'burn-subtitles' });
  const peek = await post(stranger.request, '/api/v1/jobs/quote', {
    tool_id: 'burn-subtitles',
    upload_id: theirs.id,
    options: { subtitles: subs.id },
  });
  expect(peek.status()).toBe(404);
  await other2.close();
  await post(page.request, `/api/v1/jobs/${job.id}/cancel`, {});
});
