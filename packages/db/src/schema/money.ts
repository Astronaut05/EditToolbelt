/**
 * Money (docs/04 → Money, docs/05): the append-only credit ledger, purchases
 * and the payment webhooks they come from.
 *
 * `credit_transactions` is never updated or deleted: a trigger raises on
 * UPDATE, DELETE and TRUNCATE (migrations/0002_ledger_append_only.sql). Check
 * constraints keep each kind's sign. Every write goes through `applyCredit`.
 */
import { sql } from 'drizzle-orm';
import {
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
    error: text('error'),
  },
  (t) => [uniqueIndex('webhook_events_provider_event_key').on(t.provider, t.eventId)],
);

export const purchaseStatus = pgEnum('purchase_status', [
  'pending',
  'completed',
  'refunded',
  'partially_refunded',
  'chargeback',
]);

export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    /** Idempotency for webhooks. */
    providerTxnId: text('provider_txn_id').notNull().unique(),
    /** A pack id from config/business.ts. */
    packId: text('pack_id').notNull(),
    credits: integer('credits').notNull(),
    /** What the customer paid, in the currency's minor units. */
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: purchaseStatus('status').notNull().default('pending'),
    rawEventId: uuid('raw_event_id').references(() => webhookEvents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('purchases_user_id_idx').on(t.userId, t.createdAt)],
);

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
    check('credit_transactions_balance_after_nonnegative', sql`${t.balanceAfter} >= 0`),
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
  ],
);
