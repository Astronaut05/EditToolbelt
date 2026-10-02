/**
 * Click, Shop API (Prepare and Complete): Uzbekistan, UZS, Uzcard and Humo
 * (docs/DECISIONS.md → "Click: Prepare and Complete").
 *
 * - Checkout: a redirect to Click's payment page with our purchase id as
 *   `transaction_param` and the amount in sums.
 * - Click then calls us twice, form-encoded and signed with md5:
 *   Prepare (action 0) checks the order and amount and gets a
 *   merchant_prepare_id; Complete (action 1) completes the purchase, or
 *   cancels it when Click's own `error` is negative.
 * - Every answer is HTTP 200 JSON with Click's error code; Click reverses a
 *   payment whose Complete isn't answered 0, so a repeated Complete for the
 *   same click_trans_id answers 0 again (and adds no second ledger row).
 */
import { createHash, randomInt } from 'node:crypto';

import type { Checkout, PaymentProvider, ProviderContext, PurchaseRecord } from '../contract';
import {
  asInteger,
  asString,
  assertCheckoutable,
  parseSums,
  readBody,
  readEnv,
  returnUrl,
  safeEqual,
  sums,
} from './shared';

export const CLICK_ENV = [
  'CLICK_SERVICE_ID',
  'CLICK_MERCHANT_ID',
  'CLICK_MERCHANT_USER_ID',
  'CLICK_SECRET_KEY',
] as const;

export const CLICK_PAY_URL = 'https://my.click.uz/services/pay';

/** Click's answer codes and the notes Click's documentation gives them. */
export const CLICK_ERRORS = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  ORDER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  BAD_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

export type ClickErrorCode = (typeof CLICK_ERRORS)[keyof typeof CLICK_ERRORS];

export const CLICK_ERROR_NOTES: Record<ClickErrorCode, string> = {
  0: 'Success',
  [-1]: 'SIGN CHECK FAILED!',
  [-2]: 'Incorrect parameter amount',
  [-3]: 'Action not found',
  [-4]: 'Already paid',
  [-5]: 'User does not exist',
  [-6]: 'Transaction does not exist',
  [-7]: 'Failed to update user',
  [-8]: 'Error in request from click',
  [-9]: 'Transaction cancelled',
};

export const CLICK_PREPARE = '0';
export const CLICK_COMPLETE = '1';

/** The fields Click signs, in order; merchant_prepare_id only on Complete. */
export function clickSignature(
  fields: {
    click_trans_id: string;
    service_id: string;
    merchant_trans_id: string;
    merchant_prepare_id?: string;
    amount: string;
    action: string;
    sign_time: string;
  },
  secretKey: string,
): string {
  const text =
    fields.click_trans_id +
    fields.service_id +
    secretKey +
    fields.merchant_trans_id +
    (fields.action === CLICK_COMPLETE ? (fields.merchant_prepare_id ?? '') : '') +
    fields.amount +
    fields.action +
    fields.sign_time;
  return createHash('md5').update(text, 'utf8').digest('hex');
}

interface ClickRequest {
  click_trans_id: string;
  service_id: string;
  click_paydoc_id: string;
  merchant_trans_id: string;
  merchant_prepare_id: string;
  amount: string;
  action: string;
  error: string;
  sign_time: string;
  sign_string: string;
}

const REQUIRED: readonly (keyof ClickRequest)[] = [
  'click_trans_id',
  'service_id',
  'click_paydoc_id',
  'merchant_trans_id',
  'amount',
  'action',
  'error',
  'sign_time',
  'sign_string',
];

const INTEGER = /^-?\d{1,19}$/;

function parseRequest(form: URLSearchParams): ClickRequest | null {
  const value = (name: keyof ClickRequest): string => (form.get(name) ?? '').trim();
  const request: ClickRequest = {
    click_trans_id: value('click_trans_id'),
    service_id: value('service_id'),
    click_paydoc_id: value('click_paydoc_id'),
    merchant_trans_id: value('merchant_trans_id'),
    merchant_prepare_id: value('merchant_prepare_id'),
    amount: value('amount'),
    action: value('action'),
    error: value('error'),
    sign_time: value('sign_time'),
    sign_string: value('sign_string'),
  };
  if (REQUIRED.some((name) => request[name] === '')) return null;
  if (request.action === CLICK_COMPLETE && request.merchant_prepare_id === '') return null;
  for (const name of [
    'click_trans_id',
    'service_id',
    'click_paydoc_id',
    'action',
    'error',
  ] as const)
    if (!INTEGER.test(request[name])) return null;
  return request;
}

/** What we keep about a Click payment in the purchase's providerData. */
interface ClickState {
  clickTransId: string;
  prepareId: number;
}

function clickState(purchase: PurchaseRecord): ClickState | null {
  const data = purchase.providerData;
  const clickTransId = asString(data.clickTransId);
  const prepareId = asInteger(data.prepareId);
  return clickTransId && prepareId !== null ? { clickTransId, prepareId } : null;
}

/** Click's ids are integers; echo them back as numbers when they fit, as text otherwise. */
function echoId(text: string | null): number | string | undefined {
  if (!text) return undefined;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : text;
}

function answer(
  code: ClickErrorCode,
  fields: {
    click_trans_id?: string | null;
    merchant_trans_id?: string | null;
    merchant_prepare_id?: number;
    merchant_confirm_id?: number;
  } = {},
): Response {
  const body: Record<string, unknown> = {
    click_trans_id: echoId(fields.click_trans_id ?? null),
    merchant_trans_id: fields.merchant_trans_id ?? undefined,
    merchant_prepare_id: fields.merchant_prepare_id,
    merchant_confirm_id: fields.merchant_confirm_id,
    error: code,
    error_note: CLICK_ERROR_NOTES[code],
  };
  for (const key of Object.keys(body))
    if (body[key] === undefined) Reflect.deleteProperty(body, key);
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

async function prepare(
  request: ClickRequest,
  purchase: PurchaseRecord,
  ctx: ProviderContext,
): Promise<Response> {
  const ids = { click_trans_id: request.click_trans_id, merchant_trans_id: purchase.id };
  if (purchase.status === 'cancelled') return answer(CLICK_ERRORS.TRANSACTION_CANCELLED, ids);
  if (purchase.status !== 'pending') return answer(CLICK_ERRORS.ALREADY_PAID, ids);
  if (parseSums(request.amount) !== purchase.amountMinor)
    return answer(CLICK_ERRORS.INCORRECT_AMOUNT, ids);

  const state = clickState(purchase);
  if (state?.clickTransId === request.click_trans_id)
    return answer(CLICK_ERRORS.SUCCESS, { ...ids, merchant_prepare_id: state.prepareId });

  // A new Click transaction for this order (the first, or the buyer trying
  // again): the latest Prepare is the one a Complete must match.
  const prepareId = randomInt(1, 2 ** 31);
  await ctx.store.updateData(purchase.id, {
    clickTransId: request.click_trans_id,
    clickPaydocId: request.click_paydoc_id,
    prepareId,
    preparedAt: ctx.now().toISOString(),
  });
  return answer(CLICK_ERRORS.SUCCESS, { ...ids, merchant_prepare_id: prepareId });
}

async function complete(
  request: ClickRequest,
  purchase: PurchaseRecord,
  ctx: ProviderContext,
): Promise<Response> {
  const ids = { click_trans_id: request.click_trans_id, merchant_trans_id: purchase.id };
  const clickError = Number(request.error);
  const state = clickState(purchase);

  if (purchase.status === 'cancelled') return answer(CLICK_ERRORS.TRANSACTION_CANCELLED, ids);
  if (purchase.status !== 'pending') {
    // Paid already. The same Click transaction asking again gets the same
    // answer; any other payment for this order is refused, and Click reverses it.
    if (purchase.providerTxnId === request.click_trans_id && clickError >= 0 && state)
      return answer(CLICK_ERRORS.SUCCESS, { ...ids, merchant_confirm_id: state.prepareId });
    return answer(CLICK_ERRORS.ALREADY_PAID, ids);
  }
  if (
    !state ||
    state.clickTransId !== request.click_trans_id ||
    String(state.prepareId) !== request.merchant_prepare_id
  )
    return answer(CLICK_ERRORS.TRANSACTION_NOT_FOUND, ids);
  if (parseSums(request.amount) !== purchase.amountMinor)
    return answer(CLICK_ERRORS.INCORRECT_AMOUNT, ids);

  if (clickError < 0) {
    await ctx.store.cancel(purchase.id, {
      cancelledAt: ctx.now().toISOString(),
      clickError,
    });
    return answer(CLICK_ERRORS.TRANSACTION_CANCELLED, ids);
  }

  // The Click transaction becomes the purchase's in the same store call that
  // credits it: a failure leaves neither, and a pending purchase's earlier
  // attempt (one Click reversed) gives way to this one.
  let done: PurchaseRecord;
  try {
    done = await ctx.store.complete(
      purchase.id,
      { confirmedAt: ctx.now().toISOString() },
      request.click_trans_id,
    );
  } catch {
    return answer(CLICK_ERRORS.FAILED_TO_UPDATE, ids);
  }
  // Another Click payment completed the order between our read and this call: Click reverses this one.
  if (done.providerTxnId !== request.click_trans_id) return answer(CLICK_ERRORS.ALREADY_PAID, ids);
  return answer(CLICK_ERRORS.SUCCESS, { ...ids, merchant_confirm_id: state.prepareId });
}

/** Click's payment page for this purchase, with our purchase id as transaction_param. */
function checkoutUrl(purchase: PurchaseRecord, ctx: ProviderContext): string {
  assertCheckoutable(purchase, 'click');
  const config = readEnv(ctx, 'click', CLICK_ENV);
  const url = new URL(CLICK_PAY_URL);
  url.searchParams.set('service_id', config.CLICK_SERVICE_ID);
  url.searchParams.set('merchant_id', config.CLICK_MERCHANT_ID);
  url.searchParams.set('merchant_user_id', config.CLICK_MERCHANT_USER_ID);
  url.searchParams.set('amount', sums(purchase.amountMinor));
  url.searchParams.set('transaction_param', purchase.id);
  url.searchParams.set('return_url', returnUrl(ctx, purchase.id));
  return url.toString();
}

export const click: PaymentProvider = {
  id: 'click',
  currency: 'UZS',
  requiredEnv: CLICK_ENV,

  createCheckout(purchase, _buyer, ctx): Promise<Checkout> {
    // A promise either way: a refusal rejects, it doesn't throw.
    return new Promise((resolve) => {
      resolve({ kind: 'redirect', url: checkoutUrl(purchase, ctx) });
    });
  },

  async handleWebhook(request, ctx): Promise<Response> {
    let config: { CLICK_SERVICE_ID: string; CLICK_SECRET_KEY: string };
    try {
      config = readEnv(ctx, 'click', ['CLICK_SERVICE_ID', 'CLICK_SECRET_KEY']);
    } catch {
      return new Response(null, { status: 503 });
    }
    const body = await readBody(request);
    if (!body) return answer(CLICK_ERRORS.BAD_REQUEST);
    const form = new URLSearchParams(body.toString('utf8'));
    const ids = {
      click_trans_id: form.get('click_trans_id'),
      merchant_trans_id: form.get('merchant_trans_id'),
    };
    const parsed = parseRequest(form);
    if (!parsed) return answer(CLICK_ERRORS.BAD_REQUEST, ids);
    if (
      !safeEqual(parsed.sign_string.toLowerCase(), clickSignature(parsed, config.CLICK_SECRET_KEY))
    )
      return answer(CLICK_ERRORS.SIGN_CHECK_FAILED, ids);
    if (parsed.action !== CLICK_PREPARE && parsed.action !== CLICK_COMPLETE)
      return answer(CLICK_ERRORS.ACTION_NOT_FOUND, ids);
    if (parsed.service_id !== config.CLICK_SERVICE_ID) return answer(CLICK_ERRORS.BAD_REQUEST, ids);

    try {
      const purchase = await ctx.store.get(parsed.merchant_trans_id);
      if (!purchase || purchase.provider !== 'click')
        return answer(CLICK_ERRORS.ORDER_NOT_FOUND, ids);
      return parsed.action === CLICK_PREPARE
        ? await prepare(parsed, purchase, ctx)
        : await complete(parsed, purchase, ctx);
    } catch {
      return answer(CLICK_ERRORS.FAILED_TO_UPDATE, ids);
    }
  },
};
