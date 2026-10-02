/**
 * Payme, Merchant API (JSON-RPC 2.0): Uzbekistan, UZS (docs/DECISIONS.md →
 * "Payme: the Merchant API's state in providerData").
 *
 * - Checkout: a redirect to Payme's checkout with
 *   base64(`m=…;ac.order_id=…;a=…;c=…`), the amount in tiyin.
 * - Payme then calls us with Basic auth `Paycom:<key>`:
 *   CheckPerformTransaction → CreateTransaction → PerformTransaction, and
 *   CancelTransaction, CheckTransaction, GetStatement.
 * - One Payme transaction per order: its id is the purchase's providerTxnId,
 *   and its state (state, create_time, perform_time, cancel_time, reason and
 *   Payme's own time) lives in providerData. Times are in milliseconds.
 * - Every answer is HTTP 200, a JSON-RPC result or an error with Payme's code
 *   and a ru/uz/en message.
 */
import { fiscalReceipt } from '@etb/config/business';

import type { Checkout, PaymentProvider, ProviderContext, PurchaseRecord } from '../contract';
import {
  asInteger,
  asString,
  assertCheckoutable,
  isRecord,
  packFor,
  ProviderConfigError,
  readBody,
  readEnv,
  returnUrl,
  safeEqual,
} from './shared';

export const PAYME_ENV = ['PAYME_MERCHANT_ID', 'PAYME_KEY', 'PAYME_TEST'] as const;

export const PAYME_CHECKOUT = {
  live: 'https://checkout.paycom.uz',
  test: 'https://checkout.test.paycom.uz',
} as const;

/** The Basic auth login Payme sends with the merchant key. */
export const PAYME_LOGIN = 'Paycom';

/** A created transaction not performed within 12 hours is cancelled (reason 4). */
export const PAYME_TIMEOUT_MS = 12 * 60 * 60 * 1000;

/**
 * An order older than this can't start a Payme transaction, so GetStatement
 * finds every transaction by looking this far (plus a day) before `from`.
 */
export const PAYME_ORDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STATEMENT_LOOKBACK_MS = PAYME_ORDER_MAX_AGE_MS + 24 * 60 * 60 * 1000;

export const PAYME_STATE = {
  CREATED: 1,
  PERFORMED: 2,
  CANCELLED: -1,
  CANCELLED_AFTER_PERFORM: -2,
} as const;
export type PaymeState = (typeof PAYME_STATE)[keyof typeof PAYME_STATE];

/** CancelTransaction reasons; 4 is the one we set ourselves. */
export const PAYME_REASON_TIMEOUT = 4;

export const PAYME_ERRORS = {
  WRONG_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_CANCEL: -31007,
  CANNOT_PERFORM: -31008,
  /** -31050…-31099 are order (account) errors; these three are ours. */
  ORDER_NOT_FOUND: -31050,
  ORDER_NOT_PAYABLE: -31051,
  ORDER_BUSY: -31052,
  NOT_POST: -32300,
  SYSTEM_ERROR: -32400,
  AUTH: -32504,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  PARSE_ERROR: -32700,
} as const;
export type PaymeErrorCode = (typeof PAYME_ERRORS)[keyof typeof PAYME_ERRORS];

export interface PaymeMessage {
  ru: string;
  uz: string;
  en: string;
}

export const PAYME_MESSAGES: Record<PaymeErrorCode, PaymeMessage> = {
  [-31001]: { ru: 'Неверная сумма', uz: 'Notoʻgʻri summa', en: 'Wrong amount' },
  [-31003]: {
    ru: 'Транзакция не найдена',
    uz: 'Tranzaksiya topilmadi',
    en: 'Transaction not found',
  },
  [-31007]: {
    ru: 'Невозможно отменить транзакцию',
    uz: 'Tranzaksiyani bekor qilib boʻlmaydi',
    en: 'Unable to cancel the transaction',
  },
  [-31008]: {
    ru: 'Невозможно выполнить операцию',
    uz: 'Amalni bajarib boʻlmaydi',
    en: 'Unable to perform the operation',
  },
  [-31050]: { ru: 'Заказ не найден', uz: 'Buyurtma topilmadi', en: 'Order not found' },
  [-31051]: {
    ru: 'Заказ уже оплачен, отменён или устарел',
    uz: 'Buyurtma allaqachon toʻlangan, bekor qilingan yoki eskirgan',
    en: 'The order is already paid, cancelled or expired',
  },
  [-31052]: {
    ru: 'Заказ уже оплачивается другой транзакцией',
    uz: 'Buyurtma boshqa tranzaksiya orqali toʻlanmoqda',
    en: 'The order is being paid in another transaction',
  },
  [-32300]: {
    ru: 'Метод запроса должен быть POST',
    uz: 'Soʻrov usuli POST boʻlishi kerak',
    en: 'The request method must be POST',
  },
  [-32400]: { ru: 'Системная ошибка', uz: 'Tizim xatosi', en: 'System error' },
  [-32504]: {
    ru: 'Недостаточно привилегий для выполнения метода',
    uz: 'Usulni bajarish uchun huquq yetarli emas',
    en: 'Insufficient privileges to perform the method',
  },
  [-32600]: { ru: 'Неверный запрос', uz: 'Notoʻgʻri soʻrov', en: 'Invalid request' },
  [-32601]: { ru: 'Метод не найден', uz: 'Usul topilmadi', en: 'Method not found' },
  [-32700]: { ru: 'Ошибка разбора JSON', uz: 'JSON tahlilida xato', en: 'Parse error' },
};

class PaymeError extends Error {
  constructor(
    readonly code: PaymeErrorCode,
    readonly data?: string,
  ) {
    super(PAYME_MESSAGES[code].en);
    this.name = 'PaymeError';
  }
}

/** Payme's transaction, as kept in the purchase's providerData. */
export type PaymeTransactionState = {
  /** When Payme created it (CreateTransaction's `time`). */
  time: number;
  state: PaymeState;
  create_time: number;
  perform_time: number;
  cancel_time: number;
  reason: number | null;
};

const STATES: readonly number[] = Object.values(PAYME_STATE);

export function paymeState(purchase: PurchaseRecord): PaymeTransactionState | null {
  const data = purchase.providerData;
  const state = asInteger(data.state);
  const time = asInteger(data.time);
  const createTime = asInteger(data.create_time);
  if (state === null || !STATES.includes(state) || time === null || createTime === null)
    return null;
  return {
    time,
    state: state as PaymeState,
    create_time: createTime,
    perform_time: asInteger(data.perform_time) ?? 0,
    cancel_time: asInteger(data.cancel_time) ?? 0,
    reason: asInteger(data.reason),
  };
}

type Params = Record<string, unknown>;

function integerParam(params: Params, name: string, min: number): number {
  const value = asInteger(params[name]);
  if (value === null || value < min) throw new PaymeError(PAYME_ERRORS.INVALID_REQUEST, name);
  return value;
}

function stringParam(params: Params, name: string): string {
  const value = asString(params[name]);
  if (value === null) throw new PaymeError(PAYME_ERRORS.INVALID_REQUEST, name);
  return value;
}

function accountParam(params: Params): Params {
  const account = params.account;
  if (!isRecord(account)) throw new PaymeError(PAYME_ERRORS.INVALID_REQUEST, 'account');
  return account;
}

/** The order Payme names, if it can be paid this amount now; Payme's error otherwise. */
async function payableOrder(
  account: Params,
  amount: number,
  ctx: ProviderContext,
): Promise<PurchaseRecord> {
  const orderId = asString(account.order_id);
  if (orderId === null) throw new PaymeError(PAYME_ERRORS.ORDER_NOT_FOUND, 'order_id');
  const purchase = await ctx.store.get(orderId);
  if (!purchase || purchase.provider !== 'payme')
    throw new PaymeError(PAYME_ERRORS.ORDER_NOT_FOUND, 'order_id');
  if (
    purchase.status !== 'pending' ||
    ctx.now().getTime() - purchase.createdAt.getTime() > PAYME_ORDER_MAX_AGE_MS
  )
    throw new PaymeError(PAYME_ERRORS.ORDER_NOT_PAYABLE, 'order_id');
  if (amount !== purchase.amountMinor) throw new PaymeError(PAYME_ERRORS.WRONG_AMOUNT, 'amount');
  return purchase;
}

/** The fiscal receipt Payme sends to the tax service: one line, the pack (config/business.ts). */
function receiptDetail(purchase: PurchaseRecord): Record<string, unknown> {
  const credits = packFor(purchase.packId).credits;
  return {
    receipt_type: 0,
    items: [
      {
        title: `EditToolbelt credits: ${String(credits)}`,
        price: purchase.amountMinor,
        count: 1,
        code: fiscalReceipt.mxik,
        package_code: fiscalReceipt.packageCode,
        vat_percent: fiscalReceipt.vatPercent,
      },
    ],
  };
}

async function transactionFor(
  params: Params,
  ctx: ProviderContext,
): Promise<{ purchase: PurchaseRecord; state: PaymeTransactionState; paymeId: string }> {
  const paymeId = stringParam(params, 'id');
  const purchase = await ctx.store.byProviderTxn('payme', paymeId);
  const state = purchase ? paymeState(purchase) : null;
  if (!purchase || !state) throw new PaymeError(PAYME_ERRORS.TRANSACTION_NOT_FOUND, 'id');
  return { purchase, state, paymeId };
}

async function cancelForTimeout(
  purchase: PurchaseRecord,
  state: PaymeTransactionState,
  ctx: ProviderContext,
): Promise<void> {
  await ctx.store.cancel(purchase.id, {
    ...state,
    state: PAYME_STATE.CANCELLED,
    cancel_time: ctx.now().getTime(),
    reason: PAYME_REASON_TIMEOUT,
  });
}

const expired = (state: PaymeTransactionState, ctx: ProviderContext): boolean =>
  ctx.now().getTime() - state.create_time > PAYME_TIMEOUT_MS;

async function checkPerformTransaction(params: Params, ctx: ProviderContext): Promise<unknown> {
  const amount = integerParam(params, 'amount', 1);
  const purchase = await payableOrder(accountParam(params), amount, ctx);
  return { allow: true, detail: receiptDetail(purchase) };
}

async function createTransaction(params: Params, ctx: ProviderContext): Promise<unknown> {
  const paymeId = stringParam(params, 'id');
  const time = integerParam(params, 'time', 0);
  const amount = integerParam(params, 'amount', 1);
  const account = accountParam(params);
  const now = ctx.now().getTime();

  const existing = await ctx.store.byProviderTxn('payme', paymeId);
  if (existing) {
    const state = paymeState(existing);
    if (state?.state !== PAYME_STATE.CREATED) throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
    if (expired(state, ctx)) {
      await cancelForTimeout(existing, state, ctx);
      throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
    }
    return { create_time: state.create_time, transaction: existing.id, state: state.state };
  }

  const purchase = await payableOrder(account, amount, ctx);
  if (purchase.providerTxnId !== null) {
    // One active Payme transaction per order.
    const other = paymeState(purchase);
    if (other?.state === PAYME_STATE.CREATED && expired(other, ctx)) {
      await cancelForTimeout(purchase, other, ctx);
      throw new PaymeError(PAYME_ERRORS.ORDER_NOT_PAYABLE, 'order_id');
    }
    throw new PaymeError(PAYME_ERRORS.ORDER_BUSY, 'order_id');
  }
  if (now - time > PAYME_TIMEOUT_MS) throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM, 'time');

  const state: PaymeTransactionState = {
    time,
    state: PAYME_STATE.CREATED,
    create_time: now,
    perform_time: 0,
    cancel_time: 0,
    reason: null,
  };
  try {
    await ctx.store.attach(purchase.id, paymeId, state);
  } catch {
    // Another CreateTransaction for this order got there first.
    throw new PaymeError(PAYME_ERRORS.ORDER_BUSY, 'order_id');
  }
  return { create_time: now, transaction: purchase.id, state: PAYME_STATE.CREATED };
}

/** Payme's state as the store keeps it now: answers come from it, never from what this call meant to write. */
function storedState(purchase: PurchaseRecord): PaymeTransactionState {
  const state = paymeState(purchase);
  if (!state) throw new Error('The purchase lost its Payme state');
  return state;
}

/** The purchase as it is now, after a store call refused (another call for it got there first). */
async function reread(purchase: PurchaseRecord, ctx: ProviderContext) {
  const fresh = await ctx.store.get(purchase.id);
  const state = fresh ? paymeState(fresh) : null;
  return fresh && state ? { purchase: fresh, state } : null;
}

async function performTransaction(params: Params, ctx: ProviderContext): Promise<unknown> {
  const { purchase, state } = await transactionFor(params, ctx);
  if (state.state === PAYME_STATE.PERFORMED)
    return { transaction: purchase.id, perform_time: state.perform_time, state: state.state };
  if (state.state !== PAYME_STATE.CREATED) throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
  if (expired(state, ctx)) {
    await cancelForTimeout(purchase, state, ctx);
    throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
  }
  if (purchase.status !== 'pending') throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
  let done: PurchaseRecord;
  try {
    done = await ctx.store.complete(purchase.id, {
      ...state,
      state: PAYME_STATE.PERFORMED,
      perform_time: ctx.now().getTime(),
    });
  } catch (error) {
    // A CancelTransaction got there first: the transaction is cancelled, as if
    // it had arrived before this call.
    const now = await reread(purchase, ctx);
    if (now && now.state.state !== PAYME_STATE.CREATED && now.state.state !== PAYME_STATE.PERFORMED)
      throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
    throw error;
  }
  // A concurrent PerformTransaction may have completed it first: its perform_time is the one kept.
  const performed = storedState(done);
  if (performed.state !== PAYME_STATE.PERFORMED) throw new PaymeError(PAYME_ERRORS.CANNOT_PERFORM);
  return { transaction: done.id, perform_time: performed.perform_time, state: performed.state };
}

/** A performed transaction cancelled: the money goes back, and so do the credits (the balance may go below zero). */
async function cancelPerformed(
  purchase: PurchaseRecord,
  state: PaymeTransactionState,
  paymeId: string,
  reason: number,
  ctx: ProviderContext,
): Promise<unknown> {
  if (purchase.status !== 'completed' && purchase.status !== 'partially_refunded')
    throw new PaymeError(PAYME_ERRORS.CANNOT_CANCEL);
  const done = await ctx.store.refund(
    purchase.id,
    { refundId: `payme:${paymeId}` },
    {
      ...state,
      state: PAYME_STATE.CANCELLED_AFTER_PERFORM,
      cancel_time: ctx.now().getTime(),
      reason,
    },
  );
  // A concurrent cancel may have refunded it first: its cancel_time is the one kept.
  const cancelled = storedState(done);
  return { transaction: done.id, cancel_time: cancelled.cancel_time, state: cancelled.state };
}

async function cancelTransaction(params: Params, ctx: ProviderContext): Promise<unknown> {
  const reason = integerParam(params, 'reason', 1);
  const { purchase, state, paymeId } = await transactionFor(params, ctx);
  if (state.state === PAYME_STATE.CANCELLED || state.state === PAYME_STATE.CANCELLED_AFTER_PERFORM)
    return { transaction: purchase.id, cancel_time: state.cancel_time, state: state.state };
  if (state.state === PAYME_STATE.PERFORMED)
    return cancelPerformed(purchase, state, paymeId, reason, ctx);

  let done: PurchaseRecord;
  try {
    done = await ctx.store.cancel(purchase.id, {
      ...state,
      state: PAYME_STATE.CANCELLED,
      cancel_time: ctx.now().getTime(),
      reason,
    });
  } catch (error) {
    // A PerformTransaction got there first: cancel the performed transaction,
    // as if this call had arrived after it.
    const now = await reread(purchase, ctx);
    if (now?.state.state === PAYME_STATE.PERFORMED)
      return cancelPerformed(now.purchase, now.state, paymeId, reason, ctx);
    throw error;
  }
  // A concurrent cancel may have got there first: its cancel_time is the one kept.
  const cancelled = storedState(done);
  return { transaction: done.id, cancel_time: cancelled.cancel_time, state: cancelled.state };
}

async function checkTransaction(params: Params, ctx: ProviderContext): Promise<unknown> {
  const { purchase, state } = await transactionFor(params, ctx);
  return {
    create_time: state.create_time,
    perform_time: state.perform_time,
    cancel_time: state.cancel_time,
    transaction: purchase.id,
    state: state.state,
    reason: state.reason,
  };
}

async function getStatement(params: Params, ctx: ProviderContext): Promise<unknown> {
  const from = integerParam(params, 'from', 0);
  const to = integerParam(params, 'to', 0);
  const purchases = await ctx.store.list(
    'payme',
    new Date(from - STATEMENT_LOOKBACK_MS),
    new Date(to),
  );
  const transactions = purchases
    .flatMap((purchase) => {
      const state = paymeState(purchase);
      if (!state || purchase.providerTxnId === null || state.time < from || state.time > to)
        return [];
      return [
        {
          id: purchase.providerTxnId,
          time: state.time,
          amount: purchase.amountMinor,
          account: { order_id: purchase.id },
          create_time: state.create_time,
          perform_time: state.perform_time,
          cancel_time: state.cancel_time,
          transaction: purchase.id,
          state: state.state,
          reason: state.reason,
          receivers: null,
        },
      ];
    })
    .sort((a, b) => a.time - b.time);
  return { transactions };
}

const METHODS: Record<string, (params: Params, ctx: ProviderContext) => Promise<unknown>> = {
  CheckPerformTransaction: checkPerformTransaction,
  CreateTransaction: createTransaction,
  PerformTransaction: performTransaction,
  CancelTransaction: cancelTransaction,
  CheckTransaction: checkTransaction,
  GetStatement: getStatement,
};

type RpcId = string | number | null;

const NO_STORE = { 'Cache-Control': 'no-store' };

function rpcResult(id: RpcId, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result }, { headers: NO_STORE });
}

function rpcError(id: RpcId, code: PaymeErrorCode, data?: string): Response {
  const error = { code, message: PAYME_MESSAGES[code], ...(data === undefined ? {} : { data }) };
  return Response.json({ jsonrpc: '2.0', id, error }, { headers: NO_STORE });
}

/** `Authorization: Basic base64(Paycom:<key>)`, compared in constant time. */
function authorized(header: string | null, key: string): boolean {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? '');
  const given = match?.[1] ? Buffer.from(match[1], 'base64').toString('utf8') : '';
  return safeEqual(given, `${PAYME_LOGIN}:${key}`);
}

function testCheckout(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ProviderConfigError('payme', 'PAYME_TEST must be true or false');
}

/** Payme's checkout: base64 of `m=…;ac.order_id=…;a=<tiyin>;c=<return url>`. */
function checkoutUrl(purchase: PurchaseRecord, ctx: ProviderContext): string {
  assertCheckoutable(purchase, 'payme');
  const config = readEnv(ctx, 'payme', PAYME_ENV);
  const host = PAYME_CHECKOUT[testCheckout(config.PAYME_TEST) ? 'test' : 'live'];
  const back = returnUrl(ctx, purchase.id);
  if ([config.PAYME_MERCHANT_ID, purchase.id, back].some((value) => value.includes(';')))
    throw new Error("Payme's checkout parameters can't contain ';'");
  const params = `m=${config.PAYME_MERCHANT_ID};ac.order_id=${purchase.id};a=${String(purchase.amountMinor)};c=${back}`;
  return `${host}/${Buffer.from(params, 'utf8').toString('base64')}`;
}

export const payme: PaymentProvider = {
  id: 'payme',
  currency: 'UZS',
  requiredEnv: PAYME_ENV,

  createCheckout(purchase, _buyer, ctx): Promise<Checkout> {
    // A promise either way: a refusal rejects, it doesn't throw.
    return new Promise((resolve) => {
      resolve({ kind: 'redirect', url: checkoutUrl(purchase, ctx) });
    });
  },

  async handleWebhook(request, ctx): Promise<Response> {
    let key: string;
    try {
      key = readEnv(ctx, 'payme', ['PAYME_KEY']).PAYME_KEY;
    } catch {
      return new Response(null, { status: 503 });
    }
    if (request.method !== 'POST') return rpcError(null, PAYME_ERRORS.NOT_POST);
    // Credentials before anything else (docs/11 → Payments): the body of a call
    // without them is never read, so its JSON-RPC id is unknown and the -32504
    // answer carries id null, as JSON-RPC 2.0 answers a request whose id it
    // couldn't determine.
    if (!authorized(request.headers.get('authorization'), key))
      return rpcError(null, PAYME_ERRORS.AUTH);

    const body = await readBody(request);
    let payload: unknown;
    try {
      if (!body) throw new Error('body too large');
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return rpcError(null, PAYME_ERRORS.PARSE_ERROR);
    }
    const id: RpcId =
      isRecord(payload) && (typeof payload.id === 'number' || typeof payload.id === 'string')
        ? payload.id
        : null;
    if (!isRecord(payload) || typeof payload.method !== 'string' || !isRecord(payload.params))
      return rpcError(id, PAYME_ERRORS.INVALID_REQUEST);
    const method = Object.hasOwn(METHODS, payload.method) ? METHODS[payload.method] : undefined;
    if (!method) return rpcError(id, PAYME_ERRORS.METHOD_NOT_FOUND, payload.method);

    try {
      return rpcResult(id, await method(payload.params, ctx));
    } catch (error) {
      if (error instanceof PaymeError) return rpcError(id, error.code, error.data);
      return rpcError(id, PAYME_ERRORS.SYSTEM_ERROR);
    }
  },
};
