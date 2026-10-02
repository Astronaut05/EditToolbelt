import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { packs } from '@etb/config/business';
import { CreditBadge, MonoLabel } from '@etb/ui';

import {
  BuyCredits,
  type PackOffer,
  type ResumePaddle,
} from '../../../components/credits/BuyCredits';
import { SiteFrame } from '../../../components/SiteFrame';
import { formatMoney, PACK_NAMES, packAmountMinor, perCredit } from '../../../lib/money';
import { payWithOrder } from '../../../lib/pay-with';
import { currentUser } from '../../../server/account';
import { db } from '../../../server/db';
import { createPurchaseStore } from '../../../server/payments/store';
import { enabledProviders } from '../../../server/payments/switches';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Buy credits',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Paddle's default payment link points here (`?_ptxn=txn_…`, from Paddle's
 * emails and its checkout links): reopen that transaction's overlay, if it's
 * one of this buyer's purchases and Paddle is on.
 */
async function resumePaddle(
  transactionId: string | undefined,
  userId: string,
  paddleOn: boolean,
): Promise<ResumePaddle | null> {
  if (!paddleOn || !transactionId?.startsWith('txn_')) return null;
  const purchase = await createPurchaseStore(db()).byProviderTxn('paddle', transactionId);
  const token = process.env.PADDLE_CLIENT_TOKEN?.trim();
  if (!purchase || purchase.userId !== userId || purchase.status !== 'pending' || !token) {
    return null;
  }
  return {
    transactionId,
    purchaseId: purchase.id,
    clientToken: token,
    environment: process.env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  };
}

/**
 * /credits/buy (docs/05 → Packs, Payments): the packs and a way to pay. 404
 * while no provider is on. Never cross-origin isolated: Paddle's overlay and
 * the providers' pages load from their own origins (docs/01).
 */
export default async function BuyCreditsPage({ searchParams }: Props) {
  const enabled = await enabledProviders(db());
  if (enabled.length === 0) notFound();
  const params = await searchParams;
  const ptxn = typeof params._ptxn === 'string' ? params._ptxn : undefined;
  const me = await currentUser();
  if (!me) {
    const here = ptxn ? `/credits/buy?_ptxn=${encodeURIComponent(ptxn)}` : '/credits/buy';
    redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  }
  const resume = await resumePaddle(
    ptxn,
    me.user.id,
    enabled.some((provider) => provider.id === 'paddle'),
  );
  const country = (await headers()).get('cf-ipcountry');
  const payWith = payWithOrder(
    country,
    enabled.map((provider) => provider.id),
  );
  const offers: PackOffer[] = packs.map((pack) => ({
    id: pack.id,
    name: PACK_NAMES[pack.id],
    credits: pack.credits,
    price: Object.fromEntries(
      payWith.map((option) => [
        option.id,
        formatMoney(packAmountMinor(pack, option.currency), option.currency),
      ]),
    ),
    perCredit: Object.fromEntries(
      payWith.map((option) => [option.id, perCredit(pack, option.currency)]),
    ),
  }));

  return (
    <SiteFrame signedIn>
      <div className="mx-auto max-w-180 px-4 pt-8.5 pb-16 lg:px-0 lg:pt-15">
        <MonoLabel>Credits</MonoLabel>
        <h1 className="mt-4.5 text-34 leading-display font-display tracking-display lg:text-46">
          Buy credits
        </h1>
        <p className="mt-4 max-w-xl text-16.5 text-text-muted">
          Credits pay for server tools and never expire. Every browser tool stays free.
        </p>
        <p className="mt-3 text-14.5">
          You have <CreditBadge credits={me.user.creditBalance} />
        </p>
        <div className="mt-9">
          <BuyCredits payWith={payWith} packs={offers} resume={resume} />
        </div>
        <p className="mt-8 text-13.5 text-text-muted">
          Unused packs can be refunded; see{' '}
          <a href="/refunds" className="underline underline-offset-4">
            Refunds
          </a>
          . A server job that fails gives its credits back by itself.
        </p>
      </div>
    </SiteFrame>
  );
}
