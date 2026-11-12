/**
 * Giving up on an upload, against a real Postgres (TEST_DATABASE_URL; skipped
 * without it) and a stand-in for storage: whatever order storage and the web
 * finish in, no file outlives its row (CLAUDE.md rule 4). The sweeper finds
 * files only through rows: one marked deleted, or completed and then
 * deleted, is never looked at again.
 */
import { randomUUID } from 'node:crypto';

import { createDb, eq, uploads, users, type Db } from '@etb/db';
import { migrateForTests } from '@etb/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from './account';
import { ApiError } from './problem';
import { StorageError } from './storage';
import { cancelUpload, completeUpload } from './uploads';

const url = process.env.TEST_DATABASE_URL;
const holder = vi.hoisted(() => ({ db: null as Db | null }));

function testDb(): Db {
  if (!holder.db) throw new Error('no test database');
  return holder.db;
}

/** Storage as the tests script it: which keys hold a file, and what each call does. */
const storage = vi.hoisted(() => ({
  files: new Map<string, number>(),
  complete: null as null | ((key: string) => Promise<void>),
  failDelete: false,
  deleted: [] as string[],
}));

vi.mock('./db', () => ({ db: testDb }));
vi.mock('./env', () => ({ serverEnv: () => ({ SITE_URL: 'https://site.test' }) }));
vi.mock('../lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./storage', async (original) => ({
  ...(await original<typeof import('./storage')>()),
  completeMultipart: (key: string) => storage.complete?.(key) ?? Promise.resolve(),
  abortMultipart: () => Promise.resolve(),
  headObject: (key: string) => {
    const bytes = storage.files.get(key);
    return Promise.resolve(bytes === undefined ? null : { bytes });
  },
  deleteObject: (key: string) => {
    if (storage.failDelete) return Promise.reject(new StorageError('DELETE storage: 500', 500));
    storage.files.delete(key);
    storage.deleted.push(key);
    return Promise.resolve();
  },
}));

const BYTES = 1000;
const PARTS = [{ n: 1, etag: '"a"' }];

describe.skipIf(!url)('an upload that is given up on', () => {
  let close: () => Promise<void>;

  beforeAll(async () => {
    const made = createDb(url ?? '', { max: 4 });
    holder.db = made.db;
    close = () => made.pool.end();
    await migrateForTests(made.pool);
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    storage.files.clear();
    storage.deleted.length = 0;
    storage.complete = null;
    storage.failDelete = false;
  });

  /** An open upload of one part, and its owner. */
  async function open(): Promise<{ user: CurrentUser; id: string; key: string }> {
    const [user] = await testDb()
      .insert(users)
      .values({ email: `${randomUUID()}@example.test` })
      .returning();
    if (!user) throw new Error('no user');
    const key = `uploads/${randomUUID()}`;
    const [row] = await testDb()
      .insert(uploads)
      .values({
        userId: user.id,
        storageKey: key,
        bytes: BYTES,
        mimeClaimed: 'video/mp4',
        toolId: 'compress-video',
        multipartId: 'mp-1',
        partSize: BYTES,
        partCount: 1,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: uploads.id });
    if (!row) throw new Error('no upload');
    return { user, id: row.id, key };
  }

  const rowOf = async (id: string) =>
    (await testDb().select().from(uploads).where(eq(uploads.id, id)))[0];

  it('cancelled after storage joined the parts but the web never recorded it: the file goes', async () => {
    const { user, id, key } = await open();
    // Storage has the whole file; the row still says an upload is open.
    storage.files.set(key, BYTES);
    await cancelUpload(user, id);
    expect(storage.files.has(key)).toBe(false);
    const row = await rowOf(id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.multipartId).toBeNull();
  });

  it('cancelled while storage is joining the parts: the file goes, and the upload is not completed', async () => {
    const { user, id, key } = await open();
    storage.complete = async (joined) => {
      // The cancel lands first: its abort finds nothing, its delete finds no file yet.
      await cancelUpload(user, id);
      storage.files.set(joined, BYTES);
    };
    await expect(completeUpload(user, id, PARTS)).rejects.toMatchObject({ status: 410 });
    expect(storage.files.has(key)).toBe(false);
    const row = await rowOf(id);
    expect(row?.completedAt).toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it('a file that cannot be deleted keeps its row, so the sweeper still finds it', async () => {
    const cancelled = await open();
    storage.files.set(cancelled.key, BYTES);
    storage.failDelete = true;
    await expect(cancelUpload(cancelled.user, cancelled.id)).rejects.toBeInstanceOf(ApiError);
    expect((await rowOf(cancelled.id))?.deletedAt).toBeNull();
    expect((await rowOf(cancelled.id))?.multipartId).toBe('mp-1');

    // The same when the file arrived at the wrong size and its delete fails.
    const wrong = await open();
    storage.complete = (key) => {
      storage.files.set(key, BYTES - 1);
      return Promise.resolve();
    };
    await expect(completeUpload(wrong.user, wrong.id, PARTS)).rejects.toMatchObject({
      code: 'UPLOAD_INCOMPLETE',
    });
    expect((await rowOf(wrong.id))?.deletedAt).toBeNull();
    expect((await rowOf(wrong.id))?.multipartId).toBe('mp-1');
  });

  it('a second try at joining, after the first one’s answer was lost, finds the file and completes', async () => {
    const { user, id, key } = await open();
    storage.files.set(key, BYTES);
    storage.complete = () =>
      Promise.reject(new StorageError('POST storage: 404 NoSuchUpload', 404));
    await expect(completeUpload(user, id, PARTS)).resolves.toMatchObject({ status: 'uploaded' });
    expect((await rowOf(id))?.completedAt).not.toBeNull();
    expect(storage.files.has(key)).toBe(true);
  });
});
