/**
 * Plays Paddle for tests: signs webhooks exactly as Paddle does
 * (`Paddle-Signature: ts=…;h1=HMAC-SHA256(ts:body)`), builds events shaped
 * like Paddle Billing's (transaction.* and adjustment.*), and answers the
 * few API calls the provider makes (FakePaddleApi).
 */
import { createHmac, randomBytes } from 'node:crypto';

import { isRecord } from '../shared';

/** Paddle-style ids: prefix, then 26 lowercase letters and digits. */
export function paddleId(
  prefix: 'txn' | 'evt' | 'ntf' | 'adj' | 'ctm' | 'pri' | 'pro' | 'txnitm',
): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const body = [...randomBytes(26)].map((byte) => alphabet.charAt(byte % 32)).join('');
  return `${prefix}_${body}`;
}

export function paddleSignature(body: string, secret: string, tsSeconds: number): string {
  const h1 = createHmac('sha256', secret)
    .update(`${String(tsSeconds)}:${body}`)
    .digest('hex');
  return `ts=${String(tsSeconds)};h1=${h1}`;
}

/** A webhook request as Paddle sends it. `signature: null` leaves the header out. */
export function paddleWebhook(
  event: unknown,
  secret: string,
  options: { now?: Date; signature?: string | null; body?: string; url?: string } = {},
): Request {
  const body = options.body ?? JSON.stringify(event);
  const ts = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const signature =
    options.signature === undefined ? paddleSignature(body, secret, ts) : options.signature;
  if (signature !== null) headers.set('Paddle-Signature', signature);
  return new Request(options.url ?? 'http://localhost/api/webhooks/paddle', {
    method: 'POST',
    headers,
    body,
  });
}

export interface TransactionShape {
  id: string;
  status?: 'draft' | 'ready' | 'billed' | 'paid' | 'completed' | 'canceled' | 'past_due';
  purchaseId?: string | null;
  priceId?: string;
  quantity?: number;
  /** Minor units, as Paddle writes them: "500" is $5.00. */
  grandTotal?: string;
  currency?: string;
}

/** A transaction as Paddle Billing's webhooks carry it (the fields we read, and the usual others). */
export function transactionData(shape: TransactionShape): Record<string, unknown> {
  const priceId = shape.priceId ?? paddleId('pri');
  const grandTotal = shape.grandTotal ?? '500';
  const currency = shape.currency ?? 'USD';
  const quantity = shape.quantity ?? 1;
  const at = '2026-10-02T09:00:00.000000Z';
  const totals = {
    subtotal: String(Math.round(Number(grandTotal) / 1.2)),
    discount: '0',
    tax: String(Number(grandTotal) - Math.round(Number(grandTotal) / 1.2)),
    total: grandTotal,
    credit: '0',
    credit_to_balance: '0',
    balance: '0',
    grand_total: grandTotal,
    fee: '75',
    earnings: String(Number(grandTotal) - 75),
    currency_code: currency,
  };
  return {
    id: shape.id,
    status: shape.status ?? 'completed',
    customer_id: paddleId('ctm'),
    address_id: 'add_01hv8gwdfkw5z6d1yy6pa3xyrz',
    business_id: null,
    custom_data: shape.purchaseId === null ? null : { purchase_id: shape.purchaseId ?? 'unknown' },
    origin: 'web',
    collection_mode: 'automatic',
    subscription_id: null,
    invoice_id: 'inv_01hv8h0bk1kghqrnfmqjx8dx7m',
    invoice_number: '325-10566',
    billing_details: null,
    billing_period: null,
    currency_code: currency,
    discount_id: null,
    created_at: at,
    updated_at: at,
    billed_at: at,
    items: [
      {
        price: {
          id: priceId,
          description: '200 EditToolbelt credits',
          type: 'custom',
          name: '200 credits',
          product_id: paddleId('pro'),
          billing_cycle: null,
          trial_period: null,
          tax_mode: 'internal',
          unit_price: { amount: grandTotal, currency_code: currency },
          unit_price_overrides: [],
          quantity: { minimum: 1, maximum: 1 },
          status: 'active',
          custom_data: null,
        },
        quantity,
        proration: null,
      },
    ],
    details: {
      tax_rates_used: [{ tax_rate: '0.2', totals }],
      totals,
      adjusted_totals: totals,
      payout_totals: null,
      adjusted_payout_totals: null,
      line_items: [
        {
          id: paddleId('txnitm'),
          price_id: priceId,
          quantity,
          proration: null,
          tax_rate: '0.2',
          unit_totals: totals,
          totals,
          product: { id: paddleId('pro'), name: 'EditToolbelt credits: 200' },
        },
      ],
    },
    payments: [
      {
        payment_attempt_id: 'f5d3f4b8-9c8e-4f0c-9d6f-3a0c1a0c9d11',
        stored_payment_method_id: '1e5b1f3e-5c7c-4c1a-9d6e-2b0f5c4a3b21',
        amount: grandTotal,
        status: 'captured',
        error_code: null,
        method_details: { type: 'card', card: { type: 'visa', last4: '4242' } },
        created_at: at,
        captured_at: at,
      },
    ],
    checkout: { url: null },
  };
}

export interface AdjustmentShape {
  id?: string;
  transactionId: string;
  action?: 'refund' | 'chargeback' | 'chargeback_reverse' | 'chargeback_warning' | 'credit';
  status?: 'pending_approval' | 'approved' | 'rejected' | 'reversed';
  /** full: the whole transaction; partial: `total` of it. */
  type?: 'full' | 'partial';
  /** Minor units refunded. */
  total?: string;
  currency?: string;
}

export function adjustmentData(shape: AdjustmentShape): Record<string, unknown> {
  const total = shape.total ?? '500';
  const currency = shape.currency ?? 'USD';
  const type = shape.type ?? 'full';
  const at = '2026-10-02T10:00:00.000000Z';
  return {
    id: shape.id ?? paddleId('adj'),
    action: shape.action ?? 'refund',
    type,
    transaction_id: shape.transactionId,
    subscription_id: null,
    customer_id: paddleId('ctm'),
    reason: 'Unused credits',
    credit_applied_to_balance: null,
    currency_code: currency,
    status: shape.status ?? 'approved',
    items: [
      {
        id: paddleId('adj'),
        item_id: paddleId('txnitm'),
        type,
        amount: total,
        proration: null,
        totals: { subtotal: total, tax: '0', total },
      },
    ],
    totals: {
      subtotal: total,
      tax: '0',
      total,
      fee: '0',
      earnings: '0',
      currency_code: currency,
      retained_fee: '0',
    },
    payout_totals: null,
    created_at: at,
    updated_at: at,
  };
}

/** A notification envelope around `data`. */
export function paddleEvent(
  type: string,
  data: Record<string, unknown>,
  eventId: string = paddleId('evt'),
): Record<string, unknown> {
  return {
    event_id: eventId,
    event_type: type,
    occurred_at: '2026-10-02T09:00:01.000000Z',
    notification_id: paddleId('ntf'),
    data,
  };
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

/**
 * The parts of Paddle's API the provider calls, in memory. Requests without
 * `Authorization: Bearer <apiKey>` get Paddle's 403. `fail` makes the next
 * call to a path answer with Paddle's error shape.
 */
export class FakePaddleApi {
  readonly calls: RecordedCall[] = [];
  readonly transactions = new Map<string, Record<string, unknown>>();
  readonly customers = new Map<string, string>();
  private readonly failures = new Map<string, { status: number; code: string }>();

  constructor(
    private readonly apiKey: string,
    private readonly host = 'https://sandbox-api.paddle.com',
  ) {}

  fail(method: string, path: string, status: number, code: string): void {
    this.failures.set(`${method} ${path}`, { status, code });
  }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path: url.pathname + url.search, body });
    if (url.origin !== this.host) return this.error(404, 'not_found');
    const headers = new Headers(init.headers);
    if (headers.get('authorization') !== `Bearer ${this.apiKey}`)
      return this.error(403, 'forbidden');
    const failure = this.failures.get(`${method} ${url.pathname}`);
    if (failure) {
      this.failures.delete(`${method} ${url.pathname}`);
      return this.error(failure.status, failure.code);
    }
    await Promise.resolve();

    if (method === 'GET' && url.pathname === '/customers') {
      const email = url.searchParams.get('email') ?? '';
      const id = this.customers.get(email);
      return this.ok(id ? [{ id, email, status: 'active' }] : []);
    }
    if (method === 'POST' && url.pathname === '/customers' && isRecord(body)) {
      const email = String(body.email);
      if (this.customers.has(email)) return this.error(409, 'customer_already_exists');
      const id = paddleId('ctm');
      this.customers.set(email, id);
      return this.ok({ id, email, status: 'active' });
    }
    if (method === 'POST' && url.pathname === '/transactions' && isRecord(body)) {
      return this.ok(this.createTransaction(body));
    }
    const transactionPath = /^\/transactions\/(txn_[a-z0-9]+)$/.exec(url.pathname);
    if (method === 'GET' && transactionPath?.[1]) {
      const transaction = this.transactions.get(transactionPath[1]);
      return transaction ? this.ok(transaction) : this.error(404, 'entity_not_found');
    }
    if (method === 'POST' && url.pathname === '/adjustments' && isRecord(body)) {
      const transactionId = String(body.transaction_id);
      const transaction = this.transactions.get(transactionId);
      if (!transaction) return this.error(404, 'entity_not_found');
      const items: unknown[] = Array.isArray(body.items) ? body.items : [];
      const [item] = items;
      const details = isRecord(transaction.details) ? transaction.details : {};
      const paid = isRecord(details.totals) ? String(details.totals.grand_total) : '500';
      if (body.type === 'partial') {
        // Paddle's rules: one partial item of this transaction, with an amount.
        const lineItems: unknown[] = Array.isArray(details.line_items) ? details.line_items : [];
        const known = lineItems.some(
          (line) => isRecord(line) && isRecord(item) && line.id === item.item_id,
        );
        if (items.length !== 1 || !isRecord(item) || !known || item.type !== 'partial')
          return this.error(400, 'bad_request');
        if (!(Number(item.amount) > 0) || Number(item.amount) > Number(paid))
          return this.error(400, 'adjustment_amount_above_remaining_allowed');
      }
      return this.ok(
        adjustmentData({
          transactionId,
          status: 'pending_approval',
          type: body.type === 'partial' ? 'partial' : 'full',
          action: 'refund',
          total: body.type === 'partial' && isRecord(item) ? String(item.amount) : paid,
        }),
      );
    }
    return this.error(404, 'not_found');
  };

  private createTransaction(body: Record<string, unknown>): Record<string, unknown> {
    const id = paddleId('txn');
    const [item] = Array.isArray(body.items) ? (body.items as unknown[]) : [];
    const priceId = isRecord(item)
      ? typeof item.price_id === 'string'
        ? item.price_id
        : paddleId('pri')
      : paddleId('pri');
    const amount =
      isRecord(item) && isRecord(item.price) && isRecord(item.price.unit_price)
        ? String(item.price.unit_price.amount)
        : '500';
    const purchaseId = isRecord(body.custom_data) ? String(body.custom_data.purchase_id) : null;
    const transaction = {
      ...transactionData({ id, status: 'draft', purchaseId, priceId, grandTotal: amount }),
      customer_id: typeof body.customer_id === 'string' ? body.customer_id : null,
    };
    this.transactions.set(id, transaction);
    return transaction;
  }

  private ok(data: unknown): Response {
    return Response.json({ data, meta: { request_id: 'b5c0f6d4-0000-4000-8000-000000000000' } });
  }

  private error(status: number, code: string): Response {
    return Response.json(
      {
        error: { type: 'request_error', code, detail: 'Simulated error' },
        meta: { request_id: 'b5c0f6d4-0000-4000-8000-000000000001' },
      },
      { status },
    );
  }
}
