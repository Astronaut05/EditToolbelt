/**
 * The payment contract (docs/05 → Payments; docs/DECISIONS.md → "Payments: three
 * providers behind one interface, built and switched off"). Every provider
 * implements PaymentProvider; the core gives each one a PurchaseStore and
 * never lets it touch the ledger any other way.
 *
 * - Paddle: worldwide, USD, merchant of record.
 * - Click and Payme: Uzbekistan, UZS, Uzcard and Humo.
 *
 * Payments are off unless PAYMENTS_ENABLED=true AND an admin switched the
 * provider on AND its keys are set. While a provider is off its webhook path
 * answers 404 and nothing offers it.
 */
import type { PackId } from '@etb/config/business';

export type ProviderId = 'paddle' | 'click' | 'payme';
export const PROVIDER_IDS: readonly ProviderId[] = ['paddle', 'click', 'payme'];

export type Currency = 'USD' | 'UZS';

export type PurchaseStatus =
  'pending' | 'completed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'chargeback';

/** One purchase: created pending when the buyer starts checkout, our id is the order id providers see. */
export interface PurchaseRecord {
  id: string;
  userId: string;
  provider: ProviderId;
  packId: PackId;
  credits: number;
  /** Cents for USD, tiyin for UZS. */
  amountMinor: number;
  currency: Currency;
  status: PurchaseStatus;
  /** The provider's own transaction id, once it has one (Paddle txn_…, Click click_trans_id, Payme id). */
  providerTxnId: string | null;
  /** Provider-specific state: Payme's times, state and reason; Click's prepare id; Paddle's refund ids. */
  providerData: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Purchases and the ledger, for providers. Each call is one database
 * transaction; every credit change goes through applyCredit (CLAUDE.md rule 5).
 */
export interface PurchaseStore {
  get(id: string): Promise<PurchaseRecord | null>;
  byProviderTxn(provider: ProviderId, providerTxnId: string): Promise<PurchaseRecord | null>;
  /** Sets the provider's transaction id (once; a different one later is an error) and merges data. */
  attach(
    id: string,
    providerTxnId: string,
    data?: Record<string, unknown>,
  ): Promise<PurchaseRecord>;
  /** Merges provider data without changing the status. */
  updateData(id: string, data: Record<string, unknown>): Promise<PurchaseRecord>;
  /**
   * pending → completed, with the `purchase` ledger row, in one transaction.
   * With `providerTxnId`, the provider's transaction id is set in the same
   * transaction, replacing an earlier attempt's id while the purchase is
   * still pending (that attempt never paid); another purchase's id is an error.
   * Idempotent: a completed purchase comes back unchanged, with no second row
   * (the caller compares its providerTxnId). Throws on a cancelled or
   * refunded purchase.
   */
  complete(
    id: string,
    data?: Record<string, unknown>,
    providerTxnId?: string,
  ): Promise<PurchaseRecord>;
  /** pending → cancelled. No ledger row. Idempotent. Throws on a completed purchase. */
  cancel(id: string, data?: Record<string, unknown>): Promise<PurchaseRecord>;
  /**
   * completed → refunded (all credits) or partially_refunded, or chargeback,
   * with a `refund_purchase` row of −credits that may take the balance below
   * zero (docs/05 → Payments). Idempotent per refundId.
   */
  refund(
    id: string,
    opts: { refundId: string; credits?: number; chargeback?: boolean },
    data?: Record<string, unknown>,
  ): Promise<PurchaseRecord>;
  /** A provider's purchases created in [from, to], oldest first (Payme's GetStatement). */
  list(provider: ProviderId, from: Date, to: Date): Promise<PurchaseRecord[]>;
  /** Stores a raw webhook once: `fresh` is false when (provider, eventId) was seen before. */
  recordEvent(
    provider: ProviderId,
    eventId: string,
    type: string,
    payload: unknown,
  ): Promise<{ id: string; fresh: boolean }>;
  /**
   * The event was handled. `error`: something a person must look at (it
   * alerts at once). `answer`: what Click or Payme was told (their code).
   */
  markEventProcessed(id: string, error?: string, answer?: string): Promise<void>;
}

/** Where the buyer goes to pay. */
export type Checkout =
  /** Click, Payme, and Paddle's hosted checkout: a full-page redirect. */
  | { kind: 'redirect'; url: string }
  /** Paddle.js overlay on /credits/buy (a route without COEP), if hosted checkout isn't used. */
  | {
      kind: 'paddle-overlay';
      transactionId: string;
      clientToken: string;
      environment: 'sandbox' | 'production';
    };

export interface ProviderContext {
  store: PurchaseStore;
  /** The site's origin, for return URLs (from SITE_URL). */
  siteUrl: string;
  /** Provider env, read at call time (process.env in the server; fixed values in tests). */
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  /** Outbound calls (Paddle's API); a fake in tests. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface PaymentProvider {
  id: ProviderId;
  currency: Currency;
  /** Env vars it needs. The admin switch refuses to turn it on while any is unset. */
  requiredEnv: readonly string[];
  /** Starts payment for a pending purchase; where the buyer goes next. */
  createCheckout(
    purchase: PurchaseRecord,
    buyer: { email: string | null },
    ctx: ProviderContext,
  ): Promise<Checkout>;
  /**
   * Answers the provider's server-to-server call: Paddle's signed webhooks,
   * Click's Prepare and Complete, Payme's JSON-RPC. Only reached while the
   * provider is switched on; the route answers 404 otherwise.
   */
  handleWebhook(request: Request, ctx: ProviderContext): Promise<Response>;
  /** A refund through the provider's API, where there is one (Paddle). Click and Payme refunds arrive as their own calls. */
  refund?(purchase: PurchaseRecord, ctx: ProviderContext): Promise<void>;
}
