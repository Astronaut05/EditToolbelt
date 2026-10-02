/**
 * An in-memory PurchaseStore for provider tests and simulators. It follows the
 * contract (../../contract.ts) to the letter, so a provider that passes
 * against it behaves the same against the database-backed store:
 *
 * - attach sets the provider's transaction id once; the same id again only
 *   merges data, a different one throws, and one provider transaction id
 *   belongs to one purchase.
 * - complete: pending → completed with one `purchase` ledger row; a completed
 *   purchase comes back unchanged; cancelled or refunded throws.
 * - cancel: pending → cancelled, no ledger row; idempotent; completed throws.
 * - refund: completed or partially refunded → partially_refunded, refunded or
 *   chargeback with a `refund_purchase` row of −credits; idempotent per
 *   refundId; the balance may go below zero.
 * - recordEvent: `fresh` is false for a (provider, eventId) seen before.
 *
 * Every record handed out is a copy, as rows read from a database would be.
 */
import { randomUUID } from 'node:crypto';

import { packs, type PackId } from '@etb/config/business';

import type {
  Currency,
  ProviderId,
  PurchaseRecord,
  PurchaseStatus,
  PurchaseStore,
} from '../../contract';

export interface LedgerRow {
  userId: string;
  purchaseId: string;
  kind: 'purchase' | 'refund_purchase';
  credits: number;
  refundId: string | null;
  at: Date;
}

export interface StoredEvent {
  id: string;
  provider: ProviderId;
  eventId: string;
  type: string;
  payload: unknown;
  processed: boolean;
  error: string | null;
}

export interface SeedInput {
  provider: ProviderId;
  packId?: PackId;
  id?: string;
  userId?: string;
  status?: PurchaseStatus;
  createdAt?: Date;
  amountMinor?: number;
}

const REFUNDABLE: readonly PurchaseStatus[] = ['completed', 'partially_refunded'];

export class MemoryPurchaseStore implements PurchaseStore {
  readonly ledger: LedgerRow[] = [];
  readonly events: StoredEvent[] = [];
  private readonly purchases = new Map<string, PurchaseRecord>();
  /** refundIds already applied, per purchase, with the credits each took. */
  private readonly refunds = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** A pending purchase priced from config/business.ts, as checkout would create it. */
  seed(input: SeedInput): PurchaseRecord {
    const pack = packs.find((candidate) => candidate.id === (input.packId ?? 'starter'));
    if (!pack) throw new Error('Unknown pack');
    const currency: Currency = input.provider === 'paddle' ? 'USD' : 'UZS';
    const record: PurchaseRecord = {
      id: input.id ?? randomUUID(),
      userId: input.userId ?? 'user-1',
      provider: input.provider,
      packId: pack.id,
      credits: pack.credits,
      amountMinor:
        input.amountMinor ?? (currency === 'USD' ? pack.priceUsd * 100 : pack.priceUzs * 100),
      currency,
      status: input.status ?? 'pending',
      providerTxnId: null,
      providerData: {},
      createdAt: input.createdAt ?? this.now(),
    };
    this.purchases.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  /** The user's balance from the ledger rows this store wrote. */
  balance(userId = 'user-1'): number {
    return this.ledger
      .filter((row) => row.userId === userId)
      .reduce((sum, row) => sum + row.credits, 0);
  }

  ledgerFor(purchaseId: string): LedgerRow[] {
    return this.ledger.filter((row) => row.purchaseId === purchaseId);
  }

  /** Synchronous read, for assertions. */
  peek(id: string): PurchaseRecord {
    return structuredClone(this.require(id));
  }

  get(id: string): Promise<PurchaseRecord | null> {
    const found = this.purchases.get(id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  byProviderTxn(provider: ProviderId, providerTxnId: string): Promise<PurchaseRecord | null> {
    for (const record of this.purchases.values()) {
      if (record.provider === provider && record.providerTxnId === providerTxnId)
        return Promise.resolve(structuredClone(record));
    }
    return Promise.resolve(null);
  }

  attach(
    id: string,
    providerTxnId: string,
    data: Record<string, unknown> = {},
  ): Promise<PurchaseRecord> {
    return this.run(() => {
      const record = this.require(id);
      if (record.providerTxnId !== null && record.providerTxnId !== providerTxnId)
        throw new Error('The purchase already has another provider transaction');
      for (const other of this.purchases.values()) {
        if (
          other.id !== id &&
          other.provider === record.provider &&
          other.providerTxnId === providerTxnId
        )
          throw new Error('That provider transaction belongs to another purchase');
      }
      record.providerTxnId = providerTxnId;
      record.providerData = { ...record.providerData, ...structuredClone(data) };
      return record;
    });
  }

  updateData(id: string, data: Record<string, unknown>): Promise<PurchaseRecord> {
    return this.run(() => {
      const record = this.require(id);
      record.providerData = { ...record.providerData, ...structuredClone(data) };
      return record;
    });
  }

  complete(id: string, data: Record<string, unknown> = {}): Promise<PurchaseRecord> {
    return this.run(() => {
      const record = this.require(id);
      if (record.status === 'completed') return record;
      if (record.status !== 'pending')
        throw new Error(`Cannot complete a ${record.status} purchase`);
      record.status = 'completed';
      record.providerData = { ...record.providerData, ...structuredClone(data) };
      this.ledger.push({
        userId: record.userId,
        purchaseId: record.id,
        kind: 'purchase',
        credits: record.credits,
        refundId: null,
        at: this.now(),
      });
      return record;
    });
  }

  cancel(id: string, data: Record<string, unknown> = {}): Promise<PurchaseRecord> {
    return this.run(() => {
      const record = this.require(id);
      if (record.status === 'cancelled') return record;
      if (record.status !== 'pending') throw new Error(`Cannot cancel a ${record.status} purchase`);
      record.status = 'cancelled';
      record.providerData = { ...record.providerData, ...structuredClone(data) };
      return record;
    });
  }

  refund(
    id: string,
    opts: { refundId: string; credits?: number; chargeback?: boolean },
    data: Record<string, unknown> = {},
  ): Promise<PurchaseRecord> {
    return this.run(() => {
      const record = this.require(id);
      const applied = this.refunds.get(id) ?? new Map<string, number>();
      if (applied.has(opts.refundId)) return record;
      if (!REFUNDABLE.includes(record.status))
        throw new Error(`Cannot refund a ${record.status} purchase`);
      const already = [...applied.values()].reduce((sum, credits) => sum + credits, 0);
      const remaining = record.credits - already;
      const requested = opts.credits ?? remaining;
      if (!Number.isSafeInteger(requested) || requested <= 0)
        throw new Error('A refund takes a positive whole number of credits');
      const credits = Math.min(requested, remaining);
      applied.set(opts.refundId, credits);
      this.refunds.set(id, applied);
      record.status = opts.chargeback
        ? 'chargeback'
        : already + credits >= record.credits
          ? 'refunded'
          : 'partially_refunded';
      record.providerData = { ...record.providerData, ...structuredClone(data) };
      this.ledger.push({
        userId: record.userId,
        purchaseId: record.id,
        kind: 'refund_purchase',
        credits: -credits,
        refundId: opts.refundId,
        at: this.now(),
      });
      return record;
    });
  }

  list(provider: ProviderId, from: Date, to: Date): Promise<PurchaseRecord[]> {
    const found = [...this.purchases.values()]
      .filter(
        (record) =>
          record.provider === provider &&
          record.createdAt.getTime() >= from.getTime() &&
          record.createdAt.getTime() <= to.getTime(),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(structuredClone(found));
  }

  recordEvent(
    provider: ProviderId,
    eventId: string,
    type: string,
    payload: unknown,
  ): Promise<{ id: string; fresh: boolean }> {
    const seen = this.events.find(
      (event) => event.provider === provider && event.eventId === eventId,
    );
    if (seen) return Promise.resolve({ id: seen.id, fresh: false });
    const id = randomUUID();
    this.events.push({
      id,
      provider,
      eventId,
      type,
      payload: structuredClone(payload),
      processed: false,
      error: null,
    });
    return Promise.resolve({ id, fresh: true });
  }

  markEventProcessed(id: string, error?: string): Promise<void> {
    const event = this.events.find((candidate) => candidate.id === id);
    if (!event) return Promise.reject(new Error('Unknown event'));
    event.processed = true;
    event.error = error ?? null;
    return Promise.resolve();
  }

  private require(id: string): PurchaseRecord {
    const record = this.purchases.get(id);
    if (!record) throw new Error('Unknown purchase');
    return record;
  }

  /** One "transaction": the change happens in full or not at all, and a copy comes back. */
  private run(change: () => PurchaseRecord): Promise<PurchaseRecord> {
    const before = new Map(
      [...this.purchases].map(([key, value]) => [key, structuredClone(value)]),
    );
    const ledgerLength = this.ledger.length;
    try {
      return Promise.resolve(structuredClone(change()));
    } catch (error) {
      this.purchases.clear();
      for (const [key, value] of before) this.purchases.set(key, value);
      this.ledger.length = ledgerLength;
      return Promise.reject(error instanceof Error ? error : new Error('Store error'));
    }
  }
}
