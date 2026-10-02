/**
 * Plays Click's side of the Shop API against a merchant endpoint: Prepare
 * (action 0) and Complete (action 1), form-encoded, signed
 * md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id
 *     [+ merchant_prepare_id on Complete] + amount + action + sign_time).
 *
 * `send` delivers each request: the provider's handleWebhook in tests, or
 * fetch against a running server. Every field can be overridden or left out,
 * to play Click's mistakes and an attacker's.
 */
import { randomInt } from 'node:crypto';

import { CLICK_COMPLETE, CLICK_PREPARE, clickSignature } from '../click';
import { isRecord } from '../shared';

export interface ClickAnswer {
  click_trans_id?: number | string;
  merchant_trans_id?: string;
  merchant_prepare_id?: number;
  merchant_confirm_id?: number;
  error: number;
  error_note: string;
}

export type ClickField =
  | 'click_trans_id'
  | 'service_id'
  | 'click_paydoc_id'
  | 'merchant_trans_id'
  | 'merchant_prepare_id'
  | 'amount'
  | 'action'
  | 'error'
  | 'error_note'
  | 'sign_time'
  | 'sign_string';

export interface ClickCall {
  merchantTransId: string;
  /** Sums as Click writes them, e.g. "63000.00". */
  amount: string;
  clickTransId?: string;
  clickPaydocId?: string;
  /** Complete only: the id our Prepare answered. */
  merchantPrepareId?: string | number;
  /** Click's own outcome on Complete: 0, or negative when the payment failed at Click. */
  error?: number;
  errorNote?: string;
  /** Replace fields after signing (a tampered request). */
  overrides?: Partial<Record<ClickField, string>>;
  /** Leave fields out. */
  omit?: readonly ClickField[];
  /** Sign with another secret (a forged request). */
  secretKey?: string;
}

export interface ClickExchange {
  status: number;
  answer: ClickAnswer;
  sent: Record<string, string>;
}

/** Click's sign_time: "YYYY-MM-DD HH:mm:ss", Tashkent time (UTC+5). */
export function clickSignTime(date: Date): string {
  const tashkent = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return tashkent.toISOString().slice(0, 19).replace('T', ' ');
}

export function isClickAnswer(value: unknown): value is ClickAnswer {
  return isRecord(value) && typeof value.error === 'number' && typeof value.error_note === 'string';
}

export class ClickSimulator {
  private lastTransId = randomInt(1_000_000_000, 2_000_000_000);

  constructor(
    private readonly options: {
      serviceId: string;
      secretKey: string;
      send: (request: Request) => Promise<Response>;
      url?: string;
      now?: () => Date;
    },
  ) {}

  /** A fresh click_trans_id, as Click gives each payment attempt. */
  newTransId(): string {
    this.lastTransId += 1;
    return String(this.lastTransId);
  }

  prepare(call: ClickCall): Promise<ClickExchange> {
    return this.send(CLICK_PREPARE, call);
  }

  complete(call: ClickCall): Promise<ClickExchange> {
    return this.send(CLICK_COMPLETE, call);
  }

  /** Prepare then Complete, as a successful payment goes. */
  async pay(
    merchantTransId: string,
    amount: string,
  ): Promise<{ prepare: ClickExchange; complete: ClickExchange | null; clickTransId: string }> {
    const clickTransId = this.newTransId();
    const prepare = await this.prepare({ merchantTransId, amount, clickTransId });
    if (prepare.answer.error !== 0 || prepare.answer.merchant_prepare_id === undefined)
      return { prepare, complete: null, clickTransId };
    const complete = await this.complete({
      merchantTransId,
      amount,
      clickTransId,
      merchantPrepareId: prepare.answer.merchant_prepare_id,
    });
    return { prepare, complete, clickTransId };
  }

  /** Any action code, signed, e.g. one Click doesn't have. */
  async send(action: string, call: ClickCall): Promise<ClickExchange> {
    const clickTransId = call.clickTransId ?? this.newTransId();
    const fields: Record<string, string> = {
      click_trans_id: clickTransId,
      service_id: this.options.serviceId,
      click_paydoc_id: call.clickPaydocId ?? String(Number(clickTransId) + 7_000_000_000),
      merchant_trans_id: call.merchantTransId,
      amount: call.amount,
      action,
      error: String(call.error ?? 0),
      error_note: call.errorNote ?? (call.error && call.error < 0 ? 'Payment failed' : 'Success'),
      sign_time: clickSignTime(this.options.now?.() ?? new Date()),
    };
    if (action === CLICK_COMPLETE)
      fields.merchant_prepare_id = String(call.merchantPrepareId ?? '');
    fields.sign_string = clickSignature(
      {
        click_trans_id: fields.click_trans_id ?? '',
        service_id: fields.service_id ?? '',
        merchant_trans_id: fields.merchant_trans_id ?? '',
        merchant_prepare_id: fields.merchant_prepare_id ?? '',
        amount: fields.amount ?? '',
        action: fields.action ?? '',
        sign_time: fields.sign_time ?? '',
      },
      call.secretKey ?? this.options.secretKey,
    );
    Object.assign(fields, call.overrides);
    for (const name of call.omit ?? []) Reflect.deleteProperty(fields, name);

    const response = await this.options.send(
      new Request(this.options.url ?? 'http://localhost/api/webhooks/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    );
    const answer: unknown = await response.json();
    if (!isClickAnswer(answer)) throw new Error('The merchant did not answer in Click’s format');
    return { status: response.status, answer, sent: fields };
  }
}
