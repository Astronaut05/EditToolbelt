/**
 * The signed-in user, and what they can do with their account (docs/04 →
 * Account deletion, Data export; docs/08 → rights, self-serve).
 */
import { headers } from 'next/headers';

import {
  accounts,
  and,
  apiKeys,
  applyCredit,
  creditTransactions,
  desc,
  eq,
  gte,
  isNull,
  jobs,
  lt,
  purchases,
  sessions,
  sql,
  users,
  type Queryable,
} from '@etb/db';

import type { CreditList } from '@etb/core/api';

import { auth } from './auth';
import { db } from './db';
import { ApiError } from './problem';

export type CurrentUser = typeof users.$inferSelect;

/** The signed-in user's row, or null. Deleted and disabled accounts have no session. */
export async function currentUser(): Promise<{ user: CurrentUser; sessionId: string } | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const [user] = await db().select().from(users).where(eq(users.id, session.user.id));
  if (!user || user.disabledAt || user.deletedAt) return null;
  return { user, sessionId: session.session.id };
}

const JOB_HISTORY_DAYS = 90;

/**
 * "Download my data": the profile, purchases, the credit ledger, the last 90
 * days of job metadata, API keys by name and prefix, and how the user signs
 * in. No secrets, no tokens, and never a file (we keep none).
 */
export async function exportAccount(userId: string) {
  const since = new Date(Date.now() - JOB_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const d = db();
  const [profile] = await d
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      locale: users.locale,
      marketingOptIn: users.marketingOptIn,
      creditBalance: users.creditBalance,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const [signIn, bought, ledger, recentJobs, keys] = await Promise.all([
    d
      .select({ method: accounts.providerId, linkedAt: accounts.createdAt })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    d
      .select({
        id: purchases.id,
        packId: purchases.packId,
        credits: purchases.credits,
        amountMinor: purchases.amountMinor,
        currency: purchases.currency,
        status: purchases.status,
        createdAt: purchases.createdAt,
      })
      .from(purchases)
      .where(eq(purchases.userId, userId))
      .orderBy(desc(purchases.createdAt)),
    d
      .select({
        kind: creditTransactions.kind,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        jobId: creditTransactions.jobId,
        reason: creditTransactions.reason,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(creditTransactions.createdAt),
    d
      .select({
        id: jobs.id,
        toolId: jobs.toolId,
        source: jobs.source,
        status: jobs.status,
        inputMeta: jobs.inputMeta,
        outputMeta: jobs.outputMeta,
        creditsCharged: jobs.creditsCharged,
        errorCode: jobs.errorCode,
        queuedAt: jobs.queuedAt,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.userId, userId), gte(jobs.createdAt, since)))
      .orderBy(desc(jobs.createdAt)),
    d
      .select({
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile,
    signInMethods: [
      { method: 'email link' },
      ...signIn
        .filter((method) => method.method !== 'credential')
        .map((method) => ({ method: method.method, linkedAt: method.linkedAt })),
    ],
    purchases: bought,
    creditLedger: ledger,
    jobs: { days: JOB_HISTORY_DAYS, items: recentJobs },
    apiKeys: keys,
  };
}

/** Releases the credits a queued job still holds, and cancels it. */
async function cancelQueuedJobs(tx: Queryable, userId: string) {
  const queued = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, 'queued')))
    .for('update');
  for (const job of queued) {
    await tx
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: new Date(), errorCode: 'ACCOUNT_DELETED' })
      .where(eq(jobs.id, job.id));
    const [held] = await tx
      .select({ total: sql<string>`coalesce(sum(${creditTransactions.amount}), 0)` })
      .from(creditTransactions)
      .where(eq(creditTransactions.jobId, job.id));
    const reserved = -Number(held?.total ?? 0);
    if (reserved > 0) await applyCredit(tx, userId, 'release', reserved, { jobId: job.id });
  }
}

/**
 * Deletes an account (docs/04 → Account deletion): marks it deleted, signs it
 * out everywhere, revokes its API keys and cancels its queued jobs, releasing
 * their credits. The row is scrubbed into a tombstone after 30 days; signing
 * in before then restores it.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    await cancelQueuedJobs(tx, userId);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CREDIT_PAGE = 50;

/** GET /me/credits: the account's ledger, newest first; no admin notes or purchase ids. */
export async function creditHistory(userId: string, cursor: string | null): Promise<CreditList> {
  if (cursor !== null && !UUID.test(cursor)) throw new ApiError(400, 'BAD_REQUEST', 'Bad cursor');
  const rows = await db()
    .select({
      id: creditTransactions.id,
      kind: creditTransactions.kind,
      amount: creditTransactions.amount,
      balanceAfter: creditTransactions.balanceAfter,
      jobId: creditTransactions.jobId,
      createdAt: creditTransactions.createdAt,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        cursor ? lt(creditTransactions.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(creditTransactions.id))
    .limit(CREDIT_PAGE);
  return {
    entries: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      balance_after: row.balanceAfter,
      job_id: row.jobId,
      created_at: row.createdAt.toISOString(),
    })),
    next_cursor: rows.length === CREDIT_PAGE ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}
