/**
 * Starting a purchase (docs/05 → Payments): a pending purchase at the pack's
 * price in the provider's currency, then the provider's checkout. Credits are
 * only ever added later, by the provider's server call (docs/11 → Payments:
 * never trust the client's word that it paid).
 */
import type { PackId } from '@etb/config/business';
import { and, eq, purchases, type Db, type Queryable } from '@etb/db';

import type { CheckoutAnswer, PurchaseView } from '../../lib/checkout';
import { log } from '../../lib/log';
import { packAmountMinor, packById } from '../../lib/money';
import type { CurrentUser } from '../account';
import { serverEnv } from '../env';
import { ApiError } from '../problem';
import type { Checkout, ProviderContext, ProviderId } from './contract';
import { createPurchaseStore, toRecord } from './store';
import { BUY_PATH } from './urls';
import {
  canBuyCredits,
  enabledProvider,
  paymentEnv,
  PROVIDER_NAMES,
  type PaymentEnv,
} from './switches';

/**
 * What every provider call gets: the store, the site's origin, its env, a
 * clock, fetch, and whether new purchases may start (`open`).
 */
export function providerContext(
  db: Db,
  env: PaymentEnv,
  open: boolean,
  siteUrl = serverEnv().SITE_URL,
) {
  const context: ProviderContext = {
    store: createPurchaseStore(db),
    siteUrl,
    env: env.vars,
    now: () => new Date(),
    fetch: (input, init) => fetch(input, init),
    open,
  };
  return context;
}

/** 404 while payments, or this provider, are off: nothing says they exist. */
export const PAYMENTS_OFF = () =>
  new ApiError(404, 'NOT_FOUND', 'Not found', 'Credits aren’t on sale right now.');

/** A checkout a browser can be sent to: an http(s) URL, or Paddle's overlay. */
function usable(checkout: Checkout): boolean {
  if (checkout.kind === 'paddle-overlay') {
    return Boolean(checkout.transactionId && checkout.clientToken);
  }
  try {
    return ['https:', 'http:'].includes(new URL(checkout.url).protocol);
  } catch {
    return false;
  }
}

/** POST /credits/checkout: a pending purchase and where the buyer goes to pay. */
export async function startCheckout(
  db: Db,
  user: Pick<CurrentUser, 'id' | 'email'>,
  request: { packId: PackId; provider: ProviderId },
  env: PaymentEnv = paymentEnv(),
  siteUrl?: string,
): Promise<CheckoutAnswer> {
  const provider = await enabledProvider(db, request.provider, env);
  if (!provider) throw PAYMENTS_OFF();
  const pack = packById(request.packId);
  if (!pack) throw new ApiError(400, 'BAD_REQUEST', 'No such pack');
  const [row] = await db
    .insert(purchases)
    .values({
      userId: user.id,
      provider: provider.id,
      packId: pack.id,
      credits: pack.credits,
      amountMinor: packAmountMinor(pack, provider.currency),
      currency: provider.currency,
    })
    .returning();
  if (!row) throw new Error('purchase not written');
  // Only reached while the provider is on (enabledProvider above).
  const ctx = providerContext(db, env, true, siteUrl);
  let checkout: Checkout;
  try {
    checkout = await provider.createCheckout(toRecord(row), { email: user.email }, ctx);
    if (!usable(checkout)) throw new Error('unusable checkout');
  } catch (error) {
    // The provider's own words stay in the log, never the buyer's details.
    log.error(
      { err: error, provider: provider.id, purchase_id: row.id },
      'payments.checkout_failed',
    );
    await ctx.store.cancel(row.id, { checkoutFailed: true }).catch(() => undefined);
    throw new ApiError(
      502,
      'PROVIDER_UNAVAILABLE',
      `${PROVIDER_NAMES[provider.id]} isn’t answering`,
      'Nothing was charged. Try again in a minute, or pick another way to pay.',
    );
  }
  log.info(
    {
      purchase_id: row.id,
      provider: provider.id,
      pack_id: pack.id,
      user_ref: user.id,
      checkout: checkout.kind,
    },
    'payments.checkout_started',
  );
  return { purchase_id: row.id, checkout };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function purchaseView(row: typeof purchases.$inferSelect): PurchaseView {
  const record = toRecord(row);
  return {
    id: record.id,
    status: record.status,
    provider: record.provider,
    pack_id: record.packId,
    credits: record.credits,
    amount_minor: record.amountMinor,
    currency: record.currency,
    created_at: record.createdAt.toISOString(),
  };
}

/** One of the user's own purchases; anyone else's is "not found". */
export async function ownPurchase(
  db: Db,
  userId: string,
  id: string,
): Promise<typeof purchases.$inferSelect> {
  const [row] = UUID.test(id)
    ? await db
        .select()
        .from(purchases)
        .where(and(eq(purchases.id, id), eq(purchases.userId, userId)))
    : [];
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such purchase');
  return row;
}

/** Where to buy credits, while they're on sale; null otherwise (GET /me, 402 answers). */
export async function buyUrl(
  db: Queryable,
  env: PaymentEnv = paymentEnv(),
  siteUrl = serverEnv().SITE_URL,
): Promise<string | null> {
  return (await canBuyCredits(db, env)) ? new URL(BUY_PATH, siteUrl).toString() : null;
}
