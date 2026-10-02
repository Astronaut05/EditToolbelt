/**
 * The worker's ages as `/readyz/worker` reads them, against a real database
 * (TEST_DATABASE_URL; skipped without it).
 */
import { randomUUID } from 'node:crypto';

import { and, createDb, eq, serviceHeartbeats, sql, systemChecks, type Db } from '@etb/db';
import { migrateForTests } from '@etb/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { workerAges } from './worker-health';

const url = process.env.TEST_DATABASE_URL;
const holder = vi.hoisted(() => ({ db: null as Db | null }));

function testDb(): Db {
  if (!holder.db) throw new Error('no test database');
  return holder.db;
}

vi.mock('./db', () => ({ db: testDb }));

describe.skipIf(!url)('the worker’s ages in the database', () => {
  let close: () => Promise<void>;
  const instance = `test-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const made = createDb(url ?? '', { max: 2 });
    holder.db = made.db;
    close = () => made.pool.end();
    await migrateForTests(made.pool);
  });

  afterAll(async () => {
    await testDb()
      .delete(serviceHeartbeats)
      .where(
        and(eq(serviceHeartbeats.service, 'worker'), eq(serviceHeartbeats.instance, instance)),
      );
    await close();
  });

  it('are the freshest heartbeat and the sweeper’s last pass, in whole seconds', async () => {
    await testDb()
      .insert(serviceHeartbeats)
      .values({
        service: 'worker',
        instance,
        version: 'test',
        seenAt: sql`now() - interval '45 seconds'`,
      });
    await testDb()
      .insert(systemChecks)
      .values({
        name: 'retention_sweeper',
        ok: true,
        detail: {},
        ranAt: sql`now() - interval '2 minutes'`,
      })
      .onConflictDoUpdate({
        target: systemChecks.name,
        set: { ranAt: sql`now() - interval '2 minutes'` },
      });
    const ages = await workerAges();
    // Another test's worker may have checked in more recently than this one.
    expect(ages.heartbeatSec).not.toBeNull();
    expect(ages.heartbeatSec).toBeLessThanOrEqual(46);
    expect(Number.isInteger(ages.heartbeatSec)).toBe(true);
    expect(ages.sweeperSec).toBeGreaterThanOrEqual(119);
    expect(ages.sweeperSec).toBeLessThanOrEqual(125);
  });
});
