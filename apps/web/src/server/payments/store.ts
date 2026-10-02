/**
 * The PurchaseStore (contract.ts) on the database: the only way a payment
 * provider touches purchases, webhook events and, through them, the ledger
 * (CLAUDE.md rule 5).
 *
 * - Each call is one transaction. `complete` and `refund` lock the purchase
 *   row, move its status and write its ledger row through applyCredit, all
 *   or nothing.
 * - Both are idempotent: a repeat comes back unchanged and writes nothing.
 *   The database backs this up: one `purchase` row per purchase and one
 *   `refund_purchase` row per refund id (its `reason`).
 * - A refund may take the balance below zero (docs/05 → Payments). Without
 *   `credits` it takes back what's left; with them, never more than that.
 * - A webhook event counts as fresh until it's processed without an error,
 *   so a provider's retry after a failure is processed again.
 */
import type { PackId } from '@etb/config/business';
import {
  and,
  applyCredit,
  asc,
  creditTransactions,
  eq,
  gte,
  lte,
  purchases,
  sql,
  webhookEvents,
  type Queryable,
} from '@etb/db';

import { log } from '../../lib/log';
import type {
  Currency,
  ProviderId,
  PurchaseRecord,
  PurchaseStatus,
  PurchaseStore,
} from './contract';

export type PurchaseErrorCode =
  'NOT_FOUND' | 'WRONG_STATE' | 'TXN_MISMATCH' | 'TXN_TAKEN' | 'BAD_REFUND';

/** A store call that can't be done: unknown purchase, wrong state, or a clash. */
export class PurchaseError extends Error {
  constructor(
    readonly code: PurchaseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = typeof purchases.$inferSelect;

export function toRecord(row: Row): PurchaseRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as ProviderId,
    packId: row.packId as PackId,
    credits: row.credits,
    amountMinor: row.amountMinor,
    currency: row.currency as Currency,
    status: row.status,
    providerTxnId: row.providerTxnId,
    providerData: row.providerData,
    createdAt: row.createdAt,
  };
}

/** The Postgres error code under whatever wrapper the driver adds. */
function pgCode(error: unknown): string | undefined {
  let e: unknown = error;
  while (e && typeof e === 'object') {
    if ('code' in e && typeof e.code === 'string') return e.code;
    e = 'cause' in e ? e.cause : undefined;
  }
  return undefined;
}

/** Another purchase of this provider already has the transaction id we tried to set. */
const txnTaken = (error: unknown) =>
  pgCode(error) === '23505'
    ? new PurchaseError('TXN_TAKEN', 'Another purchase has this provider transaction')
    : error;

const merge = (data: Record<string, unknown> | undefined) =>
  sql`${purchases.providerData} || ${JSON.stringify(data ?? {})}::jsonb`;

async function locked(tx: Queryable, id: string): Promise<Row> {
  const [row] = UUID.test(id)
    ? await tx.select().from(purchases).where(eq(purchases.id, id)).for('update')
    : [];
  if (!row) throw new PurchaseError('NOT_FOUND', 'No such purchase');
  return row;
}

async function update(
  tx: Queryable,
  id: string,
  set: Partial<Pick<Row, 'status' | 'providerTxnId'>>,
  data?: Record<string, unknown>,
): Promise<Row> {
  const [row] = await tx
    .update(purchases)
    .set({ ...set, providerData: merge(data), updatedAt: new Date() })
    .where(eq(purchases.id, id))
    .returning();
  if (!row) throw new PurchaseError('NOT_FOUND', 'No such purchase');
  return row;
}

/** Credits already taken back from a purchase by its refunds. */
async function refundedSoFar(tx: Queryable, purchaseId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${creditTransactions.amount}), 0)` })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.purchaseId, purchaseId),
        eq(creditTransactions.kind, 'refund_purchase'),
      ),
    );
  return -Number(row?.total ?? 0);
}

const REFUNDABLE: readonly PurchaseStatus[] = [
  'completed',
  'partially_refunded',
  'refunded',
  'chargeback',
];

/** The store on `db`; on a transaction, its calls become savepoints inside it. */
export function createPurchaseStore(db: Queryable): PurchaseStore {
  return {
    async get(id) {
      if (!UUID.test(id)) return null;
      const [row] = await db.select().from(purchases).where(eq(purchases.id, id));
      return row ? toRecord(row) : null;
    },

    async byProviderTxn(provider, providerTxnId) {
      const [row] = await db
        .select()
        .from(purchases)
        .where(and(eq(purchases.provider, provider), eq(purchases.providerTxnId, providerTxnId)));
      return row ? toRecord(row) : null;
    },

    async attach(id, providerTxnId, data) {
      if (!providerTxnId) throw new PurchaseError('TXN_MISMATCH', 'Empty provider transaction id');
      try {
        return await db.transaction(async (tx) => {
          const row = await locked(tx, id);
          if (row.providerTxnId !== null && row.providerTxnId !== providerTxnId) {
            throw new PurchaseError(
              'TXN_MISMATCH',
              'This purchase already has another provider transaction',
            );
          }
          return toRecord(await update(tx, id, { providerTxnId }, data));
        });
      } catch (error) {
        throw txnTaken(error);
      }
    },

    async updateData(id, data) {
      return db.transaction(async (tx) => {
        await locked(tx, id);
        return toRecord(await update(tx, id, {}, data));
      });
    },

    async complete(id, data, providerTxnId) {
      if (providerTxnId === '')
        throw new PurchaseError('TXN_MISMATCH', 'Empty provider transaction id');
      try {
        return await db.transaction(async (tx) => {
          const row = await locked(tx, id);
          if (row.status === 'completed') return toRecord(row);
          if (row.status !== 'pending') {
            throw new PurchaseError('WRONG_STATE', `A ${row.status} purchase can't be completed`);
          }
          // A pending purchase's earlier transaction id never paid: the paying one replaces it.
          const done = await update(
            tx,
            id,
            providerTxnId === undefined
              ? { status: 'completed' }
              : { status: 'completed', providerTxnId },
            data,
          );
          const entry = await applyCredit(tx, row.userId, 'purchase', row.credits, {
            purchaseId: row.id,
          });
          log.info(
            {
              purchase_id: row.id,
              provider: row.provider,
              credits: row.credits,
              user_ref: row.userId,
              balance_after: entry.balanceAfter,
            },
            'purchase.completed',
          );
          return toRecord(done);
        });
      } catch (error) {
        throw txnTaken(error);
      }
    },

    async cancel(id, data) {
      return db.transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status === 'cancelled') return toRecord(row);
        if (row.status !== 'pending') {
          throw new PurchaseError('WRONG_STATE', `A ${row.status} purchase can't be cancelled`);
        }
        log.info({ purchase_id: row.id, provider: row.provider }, 'purchase.cancelled');
        return toRecord(await update(tx, id, { status: 'cancelled' }, data));
      });
    },

    async refund(id, opts, data) {
      const refundId = opts.refundId.trim();
      if (!refundId || refundId.length > 200) {
        throw new PurchaseError('BAD_REFUND', 'A refund needs an id of 1 to 200 characters');
      }
      if (opts.credits !== undefined && (!Number.isInteger(opts.credits) || opts.credits < 1)) {
        throw new PurchaseError('BAD_REFUND', 'Refunded credits are a whole number above zero');
      }
      return db.transaction(async (tx) => {
        const row = await locked(tx, id);
        if (!REFUNDABLE.includes(row.status)) {
          throw new PurchaseError('WRONG_STATE', `A ${row.status} purchase can't be refunded`);
        }
        const [seen] = await tx
          .select({ id: creditTransactions.id })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.purchaseId, row.id),
              eq(creditTransactions.kind, 'refund_purchase'),
              eq(creditTransactions.reason, refundId),
            ),
          );
        if (seen) return toRecord(row);
        const before = await refundedSoFar(tx, row.id);
        const left = row.credits - before;
        // Never more than is left: a provider's rounding can't take extra credits.
        const credits = Math.min(opts.credits ?? left, left);
        if (credits > 0) {
          await applyCredit(
            tx,
            row.userId,
            'refund_purchase',
            -credits,
            { purchaseId: row.id, reason: refundId },
            { allowNegativeBalance: true },
          );
        }
        const status: PurchaseStatus =
          opts.chargeback || row.status === 'chargeback'
            ? 'chargeback'
            : before + credits >= row.credits
              ? 'refunded'
              : 'partially_refunded';
        log.info(
          {
            purchase_id: row.id,
            provider: row.provider,
            credits,
            status,
            user_ref: row.userId,
          },
          'purchase.refunded',
        );
        return toRecord(await update(tx, id, { status }, data));
      });
    },

    async list(provider, from, to) {
      const rows = await db
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.provider, provider),
            gte(purchases.createdAt, from),
            lte(purchases.createdAt, to),
          ),
        )
        .orderBy(asc(purchases.createdAt), asc(purchases.id));
      return rows.map(toRecord);
    },

    async recordEvent(provider, eventId, type, payload) {
      // A new event, or one we never finished (no processed_at, or it failed with
      // an error), is fresh: the provider's retry must be processed again. Only an
      // event processed without error is a duplicate. Processing is idempotent.
      const [fresh] = await db
        .insert(webhookEvents)
        .values({ provider, eventId, type, payload: payload ?? {} })
        .onConflictDoUpdate({
          target: [webhookEvents.provider, webhookEvents.eventId],
          set: { receivedAt: new Date(), processedAt: null, error: null },
          setWhere: sql`${webhookEvents.processedAt} is null or ${webhookEvents.error} is not null`,
        })
        .returning({ id: webhookEvents.id });
      if (fresh) return { id: fresh.id, fresh: true };
      const [seen] = await db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));
      if (!seen) throw new Error('webhook event neither inserted nor found');
      return { id: seen.id, fresh: false };
    },

    async markEventProcessed(id, error, answer) {
      await db
        .update(webhookEvents)
        .set({ processedAt: new Date(), error: error ?? null, answer: answer ?? null })
        .where(eq(webhookEvents.id, id));
    },
  };
}
