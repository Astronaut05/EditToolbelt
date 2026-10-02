/**
 * Click's fiscal receipts, sent until Click accepts them
 * (docs/decisions/2026-10-02-click-fiscal-receipts.md).
 *
 * - Click's Complete queues the receipt (`fiscal_receipts`) in the same
 *   transaction that credits the purchase (payments/store.ts), so a credited
 *   Click sale always has one, and the answer to Click never waits for it.
 * - `sendDueReceipts` sends what's due, one receipt per transaction with its
 *   row locked (`for update skip locked`) while Click is asked, so two
 *   senders never send one receipt at once. The web server runs it every
 *   30 seconds and after each Click call (fiscal-sender.ts).
 * - A failed try is retried after 1, 2, 4 … minutes, at most 6 hours apart,
 *   until Click accepts it. The worker's `fiscal_receipt_unsent` rule alerts
 *   on a receipt still unsent after 6 tries or an hour.
 * - Admin → Payments → "Send again" tries one now, into the audit log.
 *
 * The body is built when it's sent, from the purchase and config/business.ts,
 * so a fix to the codes there reaches receipts still waiting. Logs carry the
 * purchase id, the try and our error words; never the body, the seller's TIN
 * or PINFL, or a key.
 */
import { fiscalReceipt, type FiscalReceiptConfig } from '@etb/config/business';
import { and, asc, eq, fiscalReceipts, lte, ne, purchases, type Db, type Queryable } from '@etb/db';

import { log } from '../../lib/log';
import { audit } from '../audit';
import type { ProviderContext } from './contract';
import { CLICK_MERCHANT_ENV, receiptBody, submitReceipt } from './providers/click-merchant';
import { paymentEnv } from './switches';

export type FiscalReceiptRow = typeof fiscalReceipts.$inferSelect;

/** Tries after which, or age after which, an unsent receipt alerts (the worker's rule). */
export const ALERT_AFTER_TRIES = 6;
export const ALERT_AFTER_MS = 60 * 60_000;

const MINUTE = 60_000;
const MAX_DELAY = 6 * 60 * MINUTE;

/** The wait after `failedTries` failed tries: 1, 2, 4, 8 … minutes, at most 6 hours. */
export function retryDelayMs(failedTries: number): number {
  const exponent = Math.min(Math.max(failedTries - 1, 0), 30);
  return Math.min(2 ** exponent * MINUTE, MAX_DELAY);
}

/** What sending reads: Click's env, the fiscal codes, fetch and a clock. */
export interface FiscalDeps {
  env: Readonly<Record<string, string | undefined>>;
  fiscal: FiscalReceiptConfig;
  fetch: ProviderContext['fetch'];
  now: () => Date;
}

/** The running server's. */
export function fiscalDeps(): FiscalDeps {
  return {
    env: paymentEnv().vars,
    fiscal: fiscalReceipt,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
}

/** Click's keys and the Merchant API URL are all set: receipts can go out. */
export function canSend(env: FiscalDeps['env']): boolean {
  return CLICK_MERCHANT_ENV.every((name) => Boolean(env[name]?.trim()));
}

type Outcome = { ok: true } | { ok: false; error: string };

/** Builds the receipt from the purchase and the config, and asks Click to take it. */
async function deliver(tx: Queryable, row: FiscalReceiptRow, deps: FiscalDeps): Promise<Outcome> {
  const [purchase] = await tx
    .select({
      credits: purchases.credits,
      amountMinor: purchases.amountMinor,
      currency: purchases.currency,
      provider: purchases.provider,
    })
    .from(purchases)
    .where(eq(purchases.id, row.purchaseId));
  if (purchase?.provider !== 'click') return { ok: false, error: 'No Click purchase for it.' };
  const built = receiptBody({
    serviceId: deps.env.CLICK_SERVICE_ID ?? '',
    paymentId: row.paymentId,
    sale: purchase,
    fiscal: deps.fiscal,
  });
  if (!built.ok) return { ok: false, error: built.problem };
  return submitReceipt(deps, built.body);
}

/** One try at a receipt the caller has locked; its outcome saved on the row. */
async function attempt(
  tx: Queryable,
  row: FiscalReceiptRow,
  deps: FiscalDeps,
): Promise<FiscalReceiptRow> {
  const outcome = await deliver(tx, row, deps);
  const now = deps.now();
  const tries = row.attempts + 1;
  const [saved] = await tx
    .update(fiscalReceipts)
    .set(
      outcome.ok
        ? { status: 'sent', attempts: tries, sentAt: now, lastError: null, nextAttemptAt: now }
        : {
            status: 'failed',
            attempts: tries,
            lastError: outcome.error.slice(0, 500),
            nextAttemptAt: new Date(now.getTime() + retryDelayMs(tries)),
          },
    )
    .where(eq(fiscalReceipts.id, row.id))
    .returning();
  if (!saved) throw new Error('fiscal receipt row gone');
  if (outcome.ok) log.info({ purchase_id: row.purchaseId, tries }, 'fiscal.sent');
  else
    // Not the error text: Click's note could echo what it was sent. It's on the row.
    log.warn(
      { purchase_id: row.purchaseId, tries, retry_at: saved.nextAttemptAt.toISOString() },
      'fiscal.failed',
    );
  return saved;
}

export interface SendSummary {
  sent: number;
  failed: number;
  /** Click's keys or URL aren't set: nothing was tried. */
  skipped: boolean;
}

/**
 * Sends up to `limit` receipts that are due, oldest due first. Each is its
 * own transaction, its row locked while Click answers (at most 15 s); a
 * receipt another sender holds is skipped.
 */
export async function sendDueReceipts(
  db: Db,
  deps: FiscalDeps = fiscalDeps(),
  limit = 20,
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, failed: 0, skipped: false };
  if (!canSend(deps.env)) return { ...summary, skipped: true };
  for (let i = 0; i < limit; i++) {
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(fiscalReceipts)
        .where(
          and(ne(fiscalReceipts.status, 'sent'), lte(fiscalReceipts.nextAttemptAt, deps.now())),
        )
        .orderBy(asc(fiscalReceipts.nextAttemptAt))
        .limit(1)
        .for('update', { skipLocked: true });
      return row ? attempt(tx, row, deps) : null;
    });
    if (!saved) break;
    if (saved.status === 'sent') summary.sent++;
    else summary.failed++;
  }
  return summary;
}

export type SendAgainResult =
  | { ok: true; status: FiscalReceiptRow['status']; error: string | null }
  | { ok: false; reason: string };

/**
 * Admin → Payments → Send again: one try now at a purchase's receipt that
 * Click hasn't accepted, whenever its next try was due. Audit-logged with
 * the admin's reason and the outcome.
 */
export async function sendReceiptAgain(
  db: Db,
  input: { adminId: string; purchaseId: string; reason: string },
  deps: FiscalDeps = fiscalDeps(),
): Promise<SendAgainResult> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500)
    return { ok: false, reason: 'Give a reason of 3 to 500 characters.' };
  if (!canSend(deps.env))
    return {
      ok: false,
      reason: `${CLICK_MERCHANT_ENV.join(', ')} must all be set on the web service to send it.`,
    };
  return db.transaction(async (tx): Promise<SendAgainResult> => {
    const [row] = await tx
      .select()
      .from(fiscalReceipts)
      .where(eq(fiscalReceipts.purchaseId, input.purchaseId))
      .for('update', { skipLocked: true });
    if (!row) {
      const [held] = await tx
        .select({ id: fiscalReceipts.id })
        .from(fiscalReceipts)
        .where(eq(fiscalReceipts.purchaseId, input.purchaseId));
      return {
        ok: false,
        reason: held
          ? 'It’s being sent right now. Look again in a minute.'
          : 'This purchase has no fiscal receipt.',
      };
    }
    if (row.status === 'sent') return { ok: false, reason: 'Click already accepted it.' };
    const saved = await attempt(tx, row, deps);
    await audit(tx, {
      adminId: input.adminId,
      action: 'purchase.fiscal_receipt_resend',
      targetType: 'purchase',
      targetId: input.purchaseId,
      before: { status: row.status, attempts: row.attempts },
      after: { status: saved.status, attempts: saved.attempts, error: saved.lastError },
      reason,
    });
    return { ok: true, status: saved.status, error: saved.lastError };
  });
}
