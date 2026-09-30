/**
 * Integration tests against a real Postgres 18 (CI: a service container). They
 * run only when TEST_DATABASE_URL is set, never against the dev database, and
 * apply the migrations first. Ledger rows can't be deleted, so every test
 * makes its own users.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from './client';
import { applyCredit, InsufficientCreditsError, ledgerMismatches } from './credits';
import { adminAuditLog, creditTransactions, sessions, users } from './schema';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const made = createDb(url ?? '', { max: 20 });
    db = made.db;
    close = () => made.pool.end();
    await migrate(db, {
      migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
    });
  });

  afterAll(async () => {
    await close();
  });

  async function newUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.test` })
      .returning({ id: users.id });
    if (!user) throw new Error('no user');
    return user.id;
  }

  /** The Postgres error code under whatever wrapper the driver adds. */
  async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      let e: unknown = error;
      while (e && typeof e === 'object') {
        if ('code' in e && typeof e.code === 'string') return e.code;
        e = 'cause' in e ? e.cause : undefined;
      }
    }
    return undefined;
  }

  it('gives ids as UUIDv7 from the database', async () => {
    const id = await newUser();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('moves the balance and writes one ledger row, in step', async () => {
    const userId = await newUser();
    const jobId = randomUUID();
    await applyCredit(db, userId, 'welcome_grant', 50);
    const reserve = await applyCredit(db, userId, 'reserve', -8, { jobId });
    await applyCredit(db, userId, 'capture', 0, { jobId });
    expect(reserve.balanceAfter).toBe(42);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.creditBalance).toBe(42);
    const rows = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    expect(rows.map((r) => r.kind)).toEqual(['welcome_grant', 'reserve', 'capture']);
    expect((await ledgerMismatches(db)).filter((m) => m.userId === userId)).toEqual([]);
  });

  it('refuses to go below zero, and writes nothing', async () => {
    const userId = await newUser();
    await applyCredit(db, userId, 'welcome_grant', 5);
    await expect(
      applyCredit(db, userId, 'reserve', -6, { jobId: randomUUID() }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    const rows = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('serialises concurrent reserves on the user row', async () => {
    const userId = await newUser();
    await applyCredit(db, userId, 'welcome_grant', 10);
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () =>
        applyCredit(db, userId, 'reserve', -1, { jobId: randomUUID() }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.creditBalance).toBe(0);
    expect((await ledgerMismatches(db)).filter((m) => m.userId === userId)).toEqual([]);
  });

  it('never updates, deletes or truncates the ledger', async () => {
    const userId = await newUser();
    const row = await applyCredit(db, userId, 'welcome_grant', 3);
    expect(
      await pgCode(
        db.update(creditTransactions).set({ amount: 300 }).where(eq(creditTransactions.id, row.id)),
      ),
    ).toBe('23001');
    expect(
      await pgCode(db.delete(creditTransactions).where(eq(creditTransactions.id, row.id))),
    ).toBe('23001');
    expect(await pgCode(db.execute(sql`truncate credit_transactions cascade`))).toBe('23001');
  });

  it('keeps each kind’s sign, and admin kinds need an admin and a reason', async () => {
    const userId = await newUser();
    const adminId = await newUser();
    await applyCredit(db, userId, 'welcome_grant', 20);
    expect(await pgCode(applyCredit(db, userId, 'purchase', -5))).toBe('23514');
    expect(await pgCode(applyCredit(db, userId, 'reserve', 5, { jobId: randomUUID() }))).toBe(
      '23514',
    );
    expect(await pgCode(applyCredit(db, userId, 'reserve', -0, {}))).toBe('23514');
    expect(await pgCode(applyCredit(db, userId, 'admin_grant', 5, { adminId }))).toBe('23514');
    const granted = await applyCredit(db, userId, 'admin_grant', 5, {
      adminId,
      reason: 'Support: failed export on 30 Sep',
    });
    expect(granted.balanceAfter).toBe(25);
  });

  it('keeps no IP address or user agent on a session', async () => {
    const userId = await newUser();
    const session = {
      userId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600_000),
    };
    await db.insert(sessions).values(session);
    expect(
      await pgCode(
        db.insert(sessions).values({ ...session, token: randomUUID(), ipAddress: '203.0.113.9' }),
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        db.insert(sessions).values({ ...session, token: randomUUID(), userAgent: 'Mozilla/5.0' }),
      ),
    ).toBe('23514');
  });

  it('treats emails case-insensitively, and lets tombstones have none', async () => {
    const email = `${randomUUID()}@Example.test`;
    await db.insert(users).values({ email });
    expect(await pgCode(db.insert(users).values({ email: email.toUpperCase() }))).toBe('23505');
    await db.insert(users).values([{ email: null }, { email: null }]);
  });

  it('never changes the admin audit log', async () => {
    const adminId = await newUser();
    const [entry] = await db
      .insert(adminAuditLog)
      .values({
        adminId,
        action: 'tool.status',
        targetType: 'tool',
        targetId: 'trim-video',
        before: { status: 'live' },
        after: { status: 'disabled' },
        reason: 'Encoder bug in Safari 26',
      })
      .returning();
    if (!entry) throw new Error('no entry');
    expect(await pgCode(db.delete(adminAuditLog).where(eq(adminAuditLog.id, entry.id)))).toBe(
      '23001',
    );
  });
});
