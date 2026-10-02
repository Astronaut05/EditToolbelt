/**
 * Click's Merchant API, for the one call we make: a sale's fiscal receipt
 * for the tax service, `POST payment/ofd_data/submit_items`
 * (docs/decisions/2026-10-02-click-fiscal-receipts.md). Sending, retrying
 * and recording it is payments/fiscal.ts.
 *
 * - The base URL is CLICK_MERCHANT_API_URL (no host in the code); its value
 *   is in docs/runbooks/turn-on-payments.md.
 * - `Auth: merchant_user_id:digest:timestamp`, digest = sha1(timestamp +
 *   secret_key) in hex, timestamp in Unix seconds. The secret key is the
 *   Shop API's (CLICK_SECRET_KEY).
 * - Amounts are in tiyin. One line per sale: the pack, quantity 1, VAT
 *   included in the price, the seller named by TIN or PINFL in
 *   `CommissionInfo`; the whole amount as `received_ecash`.
 * - Click answers `{ error_code, error_note }`; 0 is accepted.
 *
 * Nothing here logs. The body names the seller's TIN or PINFL, so it's
 * never logged or stored; errors carry our words or Click's code and note.
 */
import { createHash } from 'node:crypto';

import { sellerTaxId, type FiscalReceiptConfig, type SellerTaxId } from '@etb/config/business';
import { z } from 'zod';

import type { ProviderContext } from '../contract';

/** What sending a receipt needs from the env (names only; Admin → Payments lists them). */
export const CLICK_MERCHANT_ENV = [
  'CLICK_SERVICE_ID',
  'CLICK_MERCHANT_USER_ID',
  'CLICK_SECRET_KEY',
  'CLICK_MERCHANT_API_URL',
] as const;

export const SUBMIT_ITEMS_PATH = 'payment/ofd_data/submit_items';

/** One pack per receipt line. */
export const RECEIPT_QUANTITY = 1;

/** Item names are at most 63 characters (Click's limit). */
const NAME_MAX = 63;

/** Click waits at most this long for an answer; the next try comes later. */
export const SUBMIT_TIMEOUT_MS = 15_000;

/** `merchant_user_id:sha1(timestamp + secret_key):timestamp`, the timestamp in Unix seconds. */
export function clickAuthHeader(merchantUserId: string, secretKey: string, now: Date): string {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const digest = createHash('sha1')
    .update(timestamp + secretKey, 'utf8')
    .digest('hex');
  return `${merchantUserId}:${digest}:${timestamp}`;
}

/** The VAT inside a tax-inclusive price, in whole tiyin: price × p / (100 + p), rounded. */
export function vatIncluded(priceMinor: number, percent: number): number {
  if (percent <= 0) return 0;
  return Math.round((priceMinor * percent) / (100 + percent));
}

export interface ClickFiscalItem {
  Name: string;
  /** The MXIK (IKPU) code. */
  SPIC: string;
  PackageCode: string;
  /** One unit's price, tiyin. */
  GoodPrice: number;
  /** The line's total, tiyin. */
  Price: number;
  /** Quantity. */
  Amount: number;
  /** VAT inside `Price`, tiyin. */
  VAT: number;
  VATPercent: number;
  CommissionInfo: SellerTaxId;
}

export interface ClickReceiptBody {
  service_id: number;
  payment_id: number;
  items: ClickFiscalItem[];
  received_ecash: number;
  received_cash: number;
  received_card: number;
}

/** What a receipt is about: the sale, as the purchase row has it. */
export interface ReceiptSale {
  credits: number;
  /** Tiyin. */
  amountMinor: number;
  currency: string;
}

const ID = /^\d{1,16}$/;

/** Click's ids as JSON numbers, exactly (none of Click's ids is near 2^53). */
function asId(text: string): number | null {
  const value = Number(text.trim());
  return ID.test(text.trim()) && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The submit_items body for one sale, or what's missing: the codes and the
 * seller in config/business.ts, a well-formed VAT, Click's ids. Pure.
 */
export function receiptBody(input: {
  serviceId: string;
  paymentId: string;
  sale: ReceiptSale;
  fiscal: FiscalReceiptConfig;
}): { ok: true; body: ClickReceiptBody } | { ok: false; problem: string } {
  const { fiscal, sale } = input;
  const problems: string[] = [];
  const mxik = fiscal.mxik.trim();
  const packageCode = fiscal.packageCode.trim();
  if (!mxik) problems.push('fiscalReceipt.mxik is empty.');
  if (!packageCode) problems.push('fiscalReceipt.packageCode is empty.');
  const seller = sellerTaxId(fiscal);
  if (!seller.ok) problems.push(seller.problem);
  if (!Number.isInteger(fiscal.vatPercent) || fiscal.vatPercent < 0 || fiscal.vatPercent > 100)
    problems.push('fiscalReceipt.vatPercent must be a whole number from 0 to 100.');
  if (sale.currency !== 'UZS') problems.push('A Click receipt is in UZS.');
  if (!Number.isSafeInteger(sale.amountMinor) || sale.amountMinor <= 0)
    problems.push('The sale has no amount.');
  const serviceId = asId(input.serviceId);
  if (serviceId === null) problems.push('CLICK_SERVICE_ID is not a number.');
  const paymentId = asId(input.paymentId);
  if (paymentId === null) problems.push('Click’s payment id is not a number.');
  if (problems.length > 0 || !seller.ok || serviceId === null || paymentId === null)
    return { ok: false, problem: problems.join(' ') };

  const price = sale.amountMinor * RECEIPT_QUANTITY;
  const item: ClickFiscalItem = {
    Name: `EditToolbelt credits: ${String(sale.credits)}`.slice(0, NAME_MAX),
    SPIC: mxik,
    PackageCode: packageCode,
    GoodPrice: sale.amountMinor,
    Price: price,
    Amount: RECEIPT_QUANTITY,
    VAT: vatIncluded(price, fiscal.vatPercent),
    VATPercent: fiscal.vatPercent,
    CommissionInfo: seller.id,
  };
  return {
    ok: true,
    body: {
      service_id: serviceId,
      payment_id: paymentId,
      items: [item],
      // Paid through Click: electronic money, nothing in cash or at a card terminal.
      received_ecash: price,
      received_cash: 0,
      received_card: 0,
    },
  };
}

/** Click's answer: `error_code` 0 is accepted. A number, or digits as text. */
const ClickAnswer = z.object({
  error_code: z.union([
    z.number().int(),
    z
      .string()
      .regex(/^-?\d+$/)
      .transform(Number),
  ]),
  error_note: z.string().optional(),
});

export type SubmitResult = { ok: true } | { ok: false; error: string };

/** The endpoint under CLICK_MERCHANT_API_URL, whether or not it ends in `/`. */
export function submitItemsUrl(base: string): string {
  const root = base.trim().endsWith('/') ? base.trim() : `${base.trim()}/`;
  return new URL(SUBMIT_ITEMS_PATH, root).toString();
}

const short = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * Sends a receipt. Never throws: a refusal, an HTTP error, a malformed
 * answer or no answer at all comes back as `{ ok: false, error }`, in words
 * that hold no secret and no TIN or PINFL.
 */
export async function submitReceipt(
  deps: Pick<ProviderContext, 'env' | 'fetch' | 'now'>,
  body: ClickReceiptBody,
): Promise<SubmitResult> {
  const userId = deps.env.CLICK_MERCHANT_USER_ID?.trim();
  const secret = deps.env.CLICK_SECRET_KEY?.trim();
  const base = deps.env.CLICK_MERCHANT_API_URL?.trim();
  if (!userId || !secret || !base)
    return {
      ok: false,
      error:
        'CLICK_MERCHANT_USER_ID, CLICK_SECRET_KEY or CLICK_MERCHANT_API_URL is not set on the web service.',
    };
  let url: string;
  try {
    url = submitItemsUrl(base);
  } catch {
    return { ok: false, error: 'CLICK_MERCHANT_API_URL is not a URL.' };
  }
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Auth: clickAuthHeader(userId, secret, deps.now()),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { ok: false, error: `Click didn’t answer (${name}).` };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const answer = ClickAnswer.safeParse(json);
  if (!response.ok) {
    const note = answer.success
      ? `: ${String(answer.data.error_code)} ${answer.data.error_note ?? ''}`
      : '';
    return { ok: false, error: short(`Click answered HTTP ${String(response.status)}${note}`) };
  }
  if (!answer.success) return { ok: false, error: 'Click’s answer had no error_code.' };
  if (answer.data.error_code === 0) return { ok: true };
  return {
    ok: false,
    error: short(
      `Click refused it: ${String(answer.data.error_code)} ${answer.data.error_note ?? ''}`,
    ),
  };
}
