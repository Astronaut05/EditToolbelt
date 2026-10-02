/**
 * Integration tests against a real Postgres 18 (CI: a service container). They
 * run only when TEST_DATABASE_URL is set, never against the dev database, and
 * apply the migrations first. Ledger rows can't be deleted, so every test
 * makes its own users.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from './client';
import { applyCredit, InsufficientCreditsError, ledgerMismatches } from './credits';
import {
  adminAuditLog,
  creditTransactions,
  paymentSettings,
  purchases,
  sessions,
  users,
} from './schema';
import { migrateForTests } from './testing';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const made = createDb(url ?? '', { max: 20 });
    db = made.db;
    close = () => made.pool.end();
    await migrateForTests(made.pool);
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

  async function newPurchase(
    userId: string,
    values: Partial<typeof purchases.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await db
      .insert(purchases)
      .values({
        userId,
        provider: 'paddle',
        packId: 'starter',
        credits: 200,
        amountMinor: 500,
        currency: 'USD',
        ...values,
      })
      .returning({ id: purchases.id });
    if (!row) throw new Error('no purchase');
    return row.id;
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

  it('lets only a refund that asks for it take a balance below zero', async () => {
    const userId = await newUser();
    const purchaseId = await newPurchase(userId);
    await applyCredit(db, userId, 'purchase', 200, { purchaseId });
    await applyCredit(db, userId, 'reserve', -150, { jobId: randomUUID() });
    // Without the option, a refund is held to zero like anything else.
    await expect(
      applyCredit(db, userId, 'refund_purchase', -200, { purchaseId, reason: 're_1' }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    const refund = await applyCredit(
      db,
      userId,
      'refund_purchase',
      -200,
      { purchaseId, reason: 're_1' },
      { allowNegativeBalance: true },
    );
    expect(refund.balanceAfter).toBe(-150);
    // Paid jobs wait for a top-up; rows that give credits back still land.
    await expect(
      applyCredit(db, userId, 'reserve', -1, { jobId: randomUUID() }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    const release = await applyCredit(db, userId, 'release', 150, { jobId: randomUUID() });
    expect(release.balanceAfter).toBe(0);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.creditBalance).toBe(0);
    expect((await ledgerMismatches(db)).filter((m) => m.userId === userId)).toEqual([]);
  });

  it('refuses the negative option on any kind but refund_purchase', async () => {
    const userId = await newUser();
    await expect(
      applyCredit(
        db,
        userId,
        'admin_debit',
        -5,
        { adminId: userId, reason: 'test' },
        { allowNegativeBalance: true },
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('keeps a negative balance_after to refund rows in the database too', async () => {
    const userId = await newUser();
    const purchaseId = await newPurchase(userId);
    const insert = (kind: 'reserve' | 'refund_purchase' | 'release', amount: number) =>
      db.insert(creditTransactions).values({
        userId,
        kind,
        amount,
        balanceAfter: -10,
        jobId: kind === 'refund_purchase' ? null : randomUUID(),
        purchaseId: kind === 'refund_purchase' ? purchaseId : null,
        reason: kind === 'refund_purchase' ? `re_${randomUUID()}` : null,
      });
    expect(await pgCode(insert('reserve', -10))).toBe('23514');
    await insert('refund_purchase', -10);
    await insert('release', 5);
    // Rows written by hand: put the cached balance in step, or the shared
    // database fails every later ledger check (the worker's included).
    await db.update(users).set({ creditBalance: -5 }).where(eq(users.id, userId));
    expect((await ledgerMismatches(db)).filter((m) => m.userId === userId)).toEqual([]);
  });

  it('writes one purchase row per purchase and one row per refund id', async () => {
    const userId = await newUser();
    const purchaseId = await newPurchase(userId);
    await applyCredit(db, userId, 'purchase', 200, { purchaseId });
    expect(await pgCode(applyCredit(db, userId, 'purchase', 200, { purchaseId }))).toBe('23505');
    const refund = () =>
      applyCredit(
        db,
        userId,
        'refund_purchase',
        -50,
        { purchaseId, reason: 're_same' },
        { allowNegativeBalance: true },
      );
    await refund();
    expect(await pgCode(refund())).toBe('23505');
    // Purchase and refund rows always name their purchase.
    expect(await pgCode(applyCredit(db, userId, 'purchase', 10))).toBe('23514');
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.creditBalance).toBe(150);
  });

  it('keeps provider transaction ids unique per provider, and lets them wait', async () => {
    const userId = await newUser();
    await newPurchase(userId);
    await newPurchase(userId);
    const txn = `txn_${randomUUID()}`;
    await newPurchase(userId, { providerTxnId: txn });
    await newPurchase(userId, { provider: 'payme', providerTxnId: txn });
    expect(await pgCode(newPurchase(userId, { providerTxnId: txn }))).toBe('23505');
    const id = await newPurchase(userId, { status: 'cancelled', provider: 'click' });
    const [row] = await db.select().from(purchases).where(eq(purchases.id, id));
    expect(row?.providerData).toEqual({});
    expect(row?.status).toBe('cancelled');
    expect(await pgCode(newPurchase(userId, { credits: 0 }))).toBe('23514');
  });

  it('keeps one payment switch per provider, off unless set', async () => {
    const provider = `test-${randomUUID()}`;
    await db.insert(paymentSettings).values({ provider });
    const [row] = await db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.provider, provider));
    expect(row?.enabled).toBe(false);
    expect(await pgCode(db.insert(paymentSettings).values({ provider }))).toBe('23505');
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
