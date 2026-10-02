/**
 * For the web server's database tests (Vitest, not the app): a migrated
 * TEST_DATABASE_URL database and throwaway users. The tests skip without it,
 * like packages/db's. Ledger rows can never be deleted, so every test makes
 * its own users.
 */
import { randomUUID } from 'node:crypto';

import { createDb, eq, purchases, users, type Db } from '@etb/db';
import { migrateForTests } from '@etb/db/testing';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export async function openTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const url = TEST_DATABASE_URL ?? '';
  await migrateForTests(url);
  const made = createDb(url, { max: 10 });
  return { db: made.db, close: () => made.pool.end() };
}

export async function newUser(db: Db, email = `${randomUUID()}@example.test`): Promise<string> {
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  if (!user) throw new Error('no user');
  return user.id;
}

export async function newPurchase(
  db: Db,
  userId: string,
  values: Partial<typeof purchases.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(purchases)
    .values({
      userId,
      provider: 'paddle',
      packId: 'creator',
      credits: 700,
      amountMinor: 1500,
      currency: 'USD',
      ...values,
    })
    .returning({ id: purchases.id });
  if (!row) throw new Error('no purchase');
  return row.id;
}

export async function balanceOf(db: Db, userId: string): Promise<number> {
  const [user] = await db
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId));
  return user?.balance ?? Number.NaN;
}
