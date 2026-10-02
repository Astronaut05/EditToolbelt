/**
 * Money (docs/04 → Money, docs/05): the append-only credit ledger, purchases,
 * the payment webhooks they come from, Click's fiscal receipts and the
 * admin's payment switches.
 *
 * `credit_transactions` is never updated or deleted: a trigger raises on
 * UPDATE, DELETE and TRUNCATE (migrations/0002_ledger_append_only.sql). Check
 * constraints keep each kind's sign. Every write goes through `applyCredit`.
 *
 * Only a `refund_purchase` row may take a balance below zero (docs/05: a
 * refunded pack's credits come off even when some were spent); a negative
 * balance then blocks paid jobs until it's topped up. Rows that add or keep
 * credits may leave it below zero; nothing else may push it further down.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tstz, updatedAt } from './columns';
import { users } from './identity';

export const CREDIT_KINDS = [
  'purchase',
  'welcome_grant',
  'admin_grant',
  'reserve',
  'capture',
  'release',
  'refund_purchase',
  'admin_debit',
] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export const creditKind = pgEnum('credit_kind', CREDIT_KINDS);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
    /** Something a person must look at (it alerts at once): a payment not credited, a store failure. */
    error: text('error'),
    /**
     * Click and Payme, which wait for an answer: the one we gave (their error
     * code and its note, or `result`). A refusal their protocol expects is an
     * answer, not an `error`.
     */
    answer: text('answer'),
  },
  (t) => [uniqueIndex('webhook_events_provider_event_key').on(t.provider, t.eventId)],
);

export const PURCHASE_STATUSES = [
  'pending',
  'completed',
  'cancelled',
  'refunded',
  'partially_refunded',
  'chargeback',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const purchaseStatus = pgEnum('purchase_status', PURCHASE_STATUSES);

export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** `paddle`, `click` or `payme`. */
    provider: text('provider').notNull(),
    /**
     * The provider's own transaction id, once it has one (unique per
     * provider): Paddle's txn_…, Click's click_trans_id, Payme's id. Null
     * while the buyer is still at checkout.
     */
    providerTxnId: text('provider_txn_id'),
    /** A pack id from config/business.ts. */
    packId: text('pack_id').notNull(),
    credits: integer('credits').notNull(),
    /** What the customer paid, in the currency's minor units. */
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: purchaseStatus('status').notNull().default('pending'),
    /** Provider-specific state: Payme's times and reason, Click's prepare id, Paddle's refunds. */
    providerData: jsonb('provider_data')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    rawEventId: uuid('raw_event_id').references(() => webhookEvents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('purchases_user_id_idx').on(t.userId, t.createdAt),
    index('purchases_provider_created_idx').on(t.provider, t.createdAt),
    uniqueIndex('purchases_provider_txn_key').on(t.provider, t.providerTxnId),
    check('purchases_positive', sql`${t.credits} > 0 and ${t.amountMinor} > 0`),
  ],
);

export const FISCAL_RECEIPT_STATUSES = ['pending', 'sent', 'failed'] as const;
export type FiscalReceiptStatus = (typeof FISCAL_RECEIPT_STATUSES)[number];

export const fiscalReceiptStatus = pgEnum('fiscal_receipt_status', FISCAL_RECEIPT_STATUSES);

/**
 * The fiscal receipts we send ourselves (docs/05 → Payments): Click's, one
 * per purchase, queued in the transaction that credits it and sent to
 * Click's Merchant API (`ofd_data/submit_items`) by the web server, again
 * and again with backoff until Click accepts it. `pending`: not tried yet;
 * `failed`: the last try failed and another is due at `next_attempt_at`;
 * `sent`: Click accepted it. No personal data, and never the seller's TIN or
 * PINFL (they come from config/business.ts when it's sent).
 */
export const fiscalReceipts = pgTable(
  'fiscal_receipts',
  {
    id: id(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    /** Click's payment id (`click_paydoc_id` from Complete): the receipt's `payment_id`. */
    paymentId: text('payment_id').notNull(),
    status: fiscalReceiptStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** When the next try is due; pushed ahead while a try is under way, so one sender has it. */
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    /** Why the last try failed: our words, or Click's code and note. */
    lastError: text('last_error'),
    sentAt: tstz('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('fiscal_receipts_purchase_key').on(t.purchaseId),
    index('fiscal_receipts_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} <> 'sent'`),
    check('fiscal_receipts_attempts', sql`${t.attempts} >= 0`),
  ],
);

/**
 * The admin's switch per payment provider (docs/05 → Payments). A provider
 * takes money only while this is on, PAYMENTS_ENABLED=true and its keys are
 * set; no row means off. Every change is also in the admin audit log.
 */
export const paymentSettings = pgTable('payment_settings', {
  provider: text('provider').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
  reason: text('reason'),
});

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: creditKind('kind').notNull(),
    /** Positive adds to the balance, negative removes; `capture` is a 0 marker. */
    amount: integer('amount').notNull(),
    /** No foreign key: job rows go after 90 days, ledger rows never change. */
    jobId: uuid('job_id'),
    purchaseId: uuid('purchase_id').references(() => purchases.id),
    /** Who made an admin grant or debit. */
    adminId: uuid('admin_id').references(() => users.id),
    reason: text('reason'),
    /** The user's balance after this row, for auditing. */
    balanceAfter: integer('balance_after').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('credit_transactions_user_idx').on(t.userId, t.createdAt),
    index('credit_transactions_job_idx').on(t.jobId),
    // Below zero only by a refund; a row that adds or keeps credits may leave it there.
    check(
      'credit_transactions_balance_after',
      sql`${t.balanceAfter} >= 0 or ${t.amount} >= 0 or ${t.kind} = 'refund_purchase'`,
    ),
    check(
      'credit_transactions_sign',
      sql`case ${t.kind}
        when 'capture' then ${t.amount} = 0
        when 'reserve' then ${t.amount} < 0
        when 'admin_debit' then ${t.amount} < 0
        when 'refund_purchase' then ${t.amount} < 0
        else ${t.amount} > 0
      end`,
    ),
    check(
      'credit_transactions_admin_reason',
      sql`${t.kind} not in ('admin_grant', 'admin_debit') or (${t.adminId} is not null and coalesce(length(trim(${t.reason})), 0) > 0)`,
    ),
    check(
      'credit_transactions_job_ref',
      sql`${t.kind} not in ('reserve', 'capture', 'release') or ${t.jobId} is not null`,
    ),
    check(
      'credit_transactions_purchase_ref',
      sql`${t.kind} not in ('purchase', 'refund_purchase') or ${t.purchaseId} is not null`,
    ),
    // One `purchase` row per purchase, and one refund row per refund id (in `reason`).
    uniqueIndex('credit_transactions_purchase_once')
      .on(t.purchaseId)
      .where(sql`${t.kind} = 'purchase'`),
    uniqueIndex('credit_transactions_refund_once')
      .on(t.purchaseId, t.reason)
      .where(sql`${t.kind} = 'refund_purchase'`),
  ],
);
