/**
 * Plays Payme's side of the Merchant API against a merchant endpoint:
 * JSON-RPC 2.0 over POST with `Authorization: Basic base64(Paycom:<key>)`,
 * every method of a payment's life (CheckPerformTransaction →
 * CreateTransaction → PerformTransaction, CancelTransaction,
 * CheckTransaction, GetStatement), amounts in tiyin and times in ms.
 *
 * `send` delivers each request: the provider's handleWebhook in tests, or
 * fetch against a running server.
 */
import { randomBytes } from 'node:crypto';

import { PAYME_LOGIN } from '../payme';
import { isRecord } from '../shared';

export interface PaymeRpcError {
  code: number;
  message: { ru: string; uz: string; en: string };
  data?: string;
}

export interface PaymeAnswer {
  status: number;
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: PaymeRpcError;
}

export interface PaymeCallOptions {
  /** The whole Authorization header; null leaves it out. Defaults to Payme's own. */
  authorization?: string | null;
  /** Send this text as the body instead of the JSON-RPC request. */
  rawBody?: string;
  httpMethod?: string;
}

/** Payme's transaction ids: 24 hex characters. */
export const paymeId = (): string => randomBytes(12).toString('hex');

export function paymeAuthorization(key: string, login = PAYME_LOGIN): string {
  return `Basic ${Buffer.from(`${login}:${key}`, 'utf8').toString('base64')}`;
}

export class PaymeSimulator {
  private nextRequestId = 1;

  constructor(
    private readonly options: {
      key: string;
      send: (request: Request) => Promise<Response>;
      url?: string;
      now?: () => Date;
    },
  ) {}

  async call(
    method: string,
    params: Record<string, unknown>,
    options: PaymeCallOptions = {},
  ): Promise<PaymeAnswer> {
    const id = this.nextRequestId++;
    const headers = new Headers({ 'Content-Type': 'application/json; charset=UTF-8' });
    const authorization =
      options.authorization === undefined
        ? paymeAuthorization(this.options.key)
        : options.authorization;
    if (authorization !== null) headers.set('Authorization', authorization);
    const httpMethod = options.httpMethod ?? 'POST';
    const response = await this.options.send(
      new Request(this.options.url ?? 'http://localhost/api/webhooks/payme', {
        method: httpMethod,
        headers,
        ...(httpMethod === 'GET' || httpMethod === 'HEAD'
          ? {}
          : { body: options.rawBody ?? JSON.stringify({ jsonrpc: '2.0', id, method, params }) }),
      }),
    );
    const body: unknown = await response.json();
    if (!isRecord(body)) throw new Error('The merchant did not answer JSON-RPC');
    const answerId = typeof body.id === 'number' || typeof body.id === 'string' ? body.id : null;
    return {
      status: response.status,
      id: answerId,
      ...(isRecord(body.result) ? { result: body.result } : {}),
      ...(isRecord(body.error) ? { error: body.error as unknown as PaymeRpcError } : {}),
    };
  }

  private now(): number {
    return (this.options.now?.() ?? new Date()).getTime();
  }

  checkPerform(orderId: string, amount: number, options?: PaymeCallOptions): Promise<PaymeAnswer> {
    return this.call(
      'CheckPerformTransaction',
      { amount, account: { order_id: orderId } },
      options,
    );
  }

  create(
    orderId: string,
    amount: number,
    transaction: { id?: string; time?: number } = {},
  ): Promise<PaymeAnswer & { paymeId: string }> {
    const id = transaction.id ?? paymeId();
    return this.call('CreateTransaction', {
      id,
      time: transaction.time ?? this.now(),
      amount,
      account: { order_id: orderId },
    }).then((answer) => ({ ...answer, paymeId: id }));
  }

  perform(id: string): Promise<PaymeAnswer> {
    return this.call('PerformTransaction', { id });
  }

  cancel(id: string, reason: number): Promise<PaymeAnswer> {
    return this.call('CancelTransaction', { id, reason });
  }

  check(id: string): Promise<PaymeAnswer> {
    return this.call('CheckTransaction', { id });
  }

  statement(from: number, to: number): Promise<PaymeAnswer> {
    return this.call('GetStatement', { from, to });
  }

  /** A whole successful payment: check, create, perform. */
  async pay(
    orderId: string,
    amount: number,
  ): Promise<{ paymeId: string; check: PaymeAnswer; create: PaymeAnswer; perform: PaymeAnswer }> {
    const check = await this.checkPerform(orderId, amount);
    const create = await this.create(orderId, amount);
    const perform = await this.perform(create.paymeId);
    return { paymeId: create.paymeId, check, create, perform };
  }
}
