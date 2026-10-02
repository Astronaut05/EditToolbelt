/**
 * The connect flow against a real database (TEST_DATABASE_URL; skipped
 * without it): approving respects the 10-key cap, and a key is never made for
 * an account that was disabled or deleted after approving.
 */
import { randomUUID } from 'node:crypto';

import { createDb, deviceCodes, eq, users, type Db } from '@etb/db';
import { migrateForTests } from '@etb/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createKey } from './api-keys';
import { collectKey, connectLockout, connectMiss, decide, MISS_LIMIT, startDevice } from './device';
import { ApiError } from './problem';

const url = process.env.TEST_DATABASE_URL;
const holder = vi.hoisted(() => ({ db: null as Db | null }));

function testDb(): Db {
  if (!holder.db) throw new Error('no test database');
  return holder.db;
}

vi.mock('./db', () => ({ db: testDb }));
vi.mock('../lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** The problem code `collectKey` throws, or 'key' when it hands one out. */
async function pollCode(deviceCode: string): Promise<string> {
  try {
    await collectKey(deviceCode);
    return 'key';
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
}

describe('connect codes and misses', () => {
  it('lock an account out after 10 misses, wherever it tries from', () => {
    const user = randomUUID();
    const t0 = 1_000_000;
    for (let i = 0; i < MISS_LIMIT - 1; i += 1) connectMiss(user, '192.0.2.1', t0);
    expect(connectLockout(user, '192.0.2.1', t0)).toBe(0);
    connectMiss(user, '192.0.2.1', t0);
    expect(connectLockout(user, '192.0.2.1', t0 + 1000)).toBe(599);
    // Per account: another address doesn't help.
    expect(connectLockout(user, '192.0.2.99', t0 + 1000)).toBeGreaterThan(0);
    // Per address: another account from the same address is locked out too.
    expect(connectLockout(randomUUID(), '192.0.2.1', t0 + 1000)).toBeGreaterThan(0);
    // Somebody else, elsewhere, isn't.
    expect(connectLockout(randomUUID(), '192.0.2.2', t0 + 1000)).toBe(0);
    // Until the window ends.
    expect(connectLockout(user, '192.0.2.1', t0 + 600_000)).toBe(0);
  });
});

describe.skipIf(!url)('the connect flow in the database', () => {
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

  async function newUser(): Promise<string> {
    const [user] = await testDb()
      .insert(users)
      .values({ email: `${randomUUID()}@example.test` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    return user.id;
  }

  it('approves a waiting code once; then it is gone', async () => {
    const userId = await newUser();
    const { deviceCode, userCode } = await startDevice('Premiere panel');
    expect(await decide(userId, userCode, true)).toBe('done');
    expect(await decide(userId, userCode, true)).toBe('gone');
    expect(await decide(userId, 'BCDFBCDF', true)).toBe('gone');
    const collected = await collectKey(deviceCode);
    expect(collected.key).toMatch(/^etb_live_/);
  });

  it('won’t approve for an account with 10 keys, but still lets it decline', async () => {
    const userId = await newUser();
    for (let i = 0; i < 10; i += 1) await createKey(userId, `key ${String(i)}`, ['jobs:read']);
    const { userCode } = await startDevice('Premiere panel');
    expect(await decide(userId, userCode, true)).toBe('full');
    const [row] = await testDb()
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.userCode, userCode));
    expect(row?.status).toBe('pending');
    expect(row?.userId).toBeNull();
    expect(await decide(userId, userCode, false)).toBe('done');
  });

  it('makes no key once the approving account is disabled or deleted', async () => {
    for (const change of [{ disabledAt: new Date() }, { deletedAt: new Date() }]) {
      const userId = await newUser();
      const { deviceCode, userCode } = await startDevice('Premiere panel');
      expect(await decide(userId, userCode, true)).toBe('done');
      await testDb().update(users).set(change).where(eq(users.id, userId));
      expect(await pollCode(deviceCode)).toBe('ACCESS_DENIED');
    }
  });
});
