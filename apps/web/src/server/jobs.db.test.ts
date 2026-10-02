/**
 * Starting jobs with an `Idempotency-Key`, against a real database
 * (TEST_DATABASE_URL; skipped without it): a repeat answers the same job,
 * the same key with another body is refused, and retries that race the first
 * try all get its job instead of "this upload already has a job".
 */
import { randomUUID } from 'node:crypto';

import { createDb, eq, jobs, toolFlags, uploads, users, type Db } from '@etb/db';
import { migrateForTests } from '@etb/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from './account';
import { createJob } from './jobs';
import { ApiError } from './problem';

const url = process.env.TEST_DATABASE_URL;
const holder = vi.hoisted(() => ({ db: null as Db | null }));

function testDb(): Db {
  if (!holder.db) throw new Error('no test database');
  return holder.db;
}

vi.mock('./db', () => ({ db: testDb }));
vi.mock('./env', () => ({ serverEnv: () => ({ SITE_URL: 'https://site.test' }) }));
vi.mock('../lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const OPTIONS = { mode: 'size', targetMb: 10 };

describe.skipIf(!url)('starting a job with an Idempotency-Key', () => {
  let close: () => Promise<void>;

  beforeAll(async () => {
    const made = createDb(url ?? '', { max: 8 });
    holder.db = made.db;
    close = () => made.pool.end();
    await migrateForTests(made.pool);
    await made.db
      .insert(toolFlags)
      .values({ toolId: 'compress-video', serverEnabled: true })
      .onConflictDoUpdate({ target: toolFlags.toolId, set: { serverEnabled: true } });
  });

  afterAll(async () => {
    await close();
  });

  async function newUser(): Promise<CurrentUser> {
    const [user] = await testDb()
      .insert(users)
      .values({ email: `${randomUUID()}@example.test` })
      .returning();
    if (!user) throw new Error('no user');
    return user;
  }

  /** A completed upload of a 90 s video, probed: Compress Video prices it at 2. */
  async function upload(owner: CurrentUser): Promise<string> {
    const [row] = await testDb()
      .insert(uploads)
      .values({
        userId: owner.id,
        storageKey: `in/${randomUUID()}`,
        bytes: 18,
        mimeClaimed: 'video/mp4',
        toolId: 'compress-video',
        partSize: 8 * 1024 * 1024,
        partCount: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
        completedAt: new Date(),
        probe: {
          container: 'mp4',
          duration_ms: 90_000,
          video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
        },
        probedAt: new Date(),
      })
      .returning({ id: uploads.id });
    if (!row) throw new Error('no upload');
    return row.id;
  }

  const start = (owner: CurrentUser, uploadId: string, key: string | null, options = OPTIONS) =>
    createJob(owner, { toolId: 'compress-video', uploadId, options, quoteCredits: 2 }, key, 'api');

  async function problemCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return `${String(error.status)} ${error.code}`;
      throw error;
    }
    return undefined;
  }

  it('answers a repeat with the same job, whatever order the options came in', async () => {
    const owner = await newUser();
    const uploadId = await upload(owner);
    const key = randomUUID();
    const first = await start(owner, uploadId, key);
    expect(first.created).toBe(true);
    const [row] = await testDb().select().from(jobs).where(eq(jobs.id, first.job.id));
    expect(row?.idempotencyHash).toMatch(/^[0-9a-f]{64}$/);
    const again = await start(owner, uploadId, key, { targetMb: 10, mode: 'size' });
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
  });

  it('refuses the same key with another body (422)', async () => {
    const owner = await newUser();
    const uploadId = await upload(owner);
    const key = randomUUID();
    await start(owner, uploadId, key);
    expect(await problemCode(start(owner, uploadId, key, { mode: 'size', targetMb: 12 }))).toBe(
      '422 IDEMPOTENCY_KEY_REUSED',
    );
    const other = await upload(owner);
    expect(await problemCode(start(owner, other, key))).toBe('422 IDEMPOTENCY_KEY_REUSED');
  });

  it('answers jobs from before the hash was kept as it always did', async () => {
    const owner = await newUser();
    const uploadId = await upload(owner);
    const key = randomUUID();
    const first = await start(owner, uploadId, key);
    await testDb().update(jobs).set({ idempotencyHash: null }).where(eq(jobs.id, first.job.id));
    const again = await start(owner, uploadId, key, { mode: 'size', targetMb: 12 });
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
  });

  it('gives retries that race the first try its job, never a 409', async () => {
    const owner = await newUser();
    const uploadId = await upload(owner);
    const key = randomUUID();
    const tries = await Promise.all(Array.from({ length: 6 }, () => start(owner, uploadId, key)));
    expect(new Set(tries.map((t) => t.job.id)).size).toBe(1);
    expect(tries.filter((t) => t.created)).toHaveLength(1);
  });

  it('still refuses a second job for the same upload under another key (409)', async () => {
    const owner = await newUser();
    const uploadId = await upload(owner);
    await start(owner, uploadId, randomUUID());
    expect(await problemCode(start(owner, uploadId, randomUUID()))).toBe('409 CONFLICT');
    expect(await problemCode(start(owner, uploadId, null))).toBe('409 CONFLICT');
  });
});
