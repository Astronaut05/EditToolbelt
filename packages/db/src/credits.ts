/**
 * The credit ledger (docs/04 → Money, CLAUDE.md rule 5). Every balance change
 * goes through `applyCredit`: it locks the user row, appends one ledger row
 * and moves the cached balance in the same transaction, so
 * `users.credit_balance` always equals the sum of that user's rows. The
 * ledger itself is append-only (a trigger raises on UPDATE and DELETE).
 */
import { eq, sql } from 'drizzle-orm';

import type { Queryable } from './client';
import { creditTransactions, users, type CreditKind } from './schema';

export class InsufficientCreditsError extends Error {
  constructor(
    readonly balance: number,
    readonly amount: number,
  ) {
    super(`Not enough credits: balance ${String(balance)}, change ${String(amount)}`);
    this.name = 'InsufficientCreditsError';
  }
}

export interface CreditRefs {
  jobId?: string;
  purchaseId?: string;
  /** Required for admin_grant and admin_debit, with a reason. */
  adminId?: string;
  reason?: string;
}

export type LedgerRow = typeof creditTransactions.$inferSelect;

/**
 * Applies one ledger entry. Runs in its own transaction, or a savepoint when
 * `db` is already a transaction, so a failure leaves nothing half-written.
 * Throws InsufficientCreditsError when the balance would go below zero.
 */
export async function applyCredit(
  db: Queryable,
  userId: string,
  kind: CreditKind,
  amount: number,
  refs: CreditRefs = {},
): Promise<LedgerRow> {
  if (!Number.isInteger(amount)) throw new RangeError('Credits are whole numbers');
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ balance: users.creditBalance })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw new Error('No such user');
    const balanceAfter = user.balance + amount;
    if (balanceAfter < 0) throw new InsufficientCreditsError(user.balance, amount);
    const [row] = await tx
      .insert(creditTransactions)
      .values({
        userId,
        kind,
        amount,
        balanceAfter,
        jobId: refs.jobId ?? null,
        purchaseId: refs.purchaseId ?? null,
        adminId: refs.adminId ?? null,
        reason: refs.reason ?? null,
      })
      .returning();
    if (!row) throw new Error('The ledger row was not written');
    await tx.update(users).set({ creditBalance: balanceAfter }).where(eq(users.id, userId));
    return row;
  });
}

/** Users whose cached balance differs from their ledger: should always be none (checked nightly). */
export async function ledgerMismatches(
  db: Queryable,
): Promise<{ userId: string; balance: number; ledger: number }[]> {
  const result = await db.execute<{ user_id: string; balance: number; ledger: string }>(sql`
    select u.id as user_id, u.credit_balance as balance, coalesce(sum(t.amount), 0) as ledger
    from users u
    left join credit_transactions t on t.user_id = u.id
    group by u.id
    having u.credit_balance <> coalesce(sum(t.amount), 0)
  `);
  return result.rows.map((row) => ({
    userId: row.user_id,
    balance: row.balance,
    ledger: Number(row.ledger),
  }));
}
