import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { MonoLabel } from '@etb/ui';

import { PurchaseProgress } from '../../../components/credits/PurchaseProgress';
import { SiteFrame } from '../../../components/SiteFrame';
import { formatMoney, PACK_NAMES } from '../../../lib/money';
import { currentUser } from '../../../server/account';
import { db } from '../../../server/db';
import { ApiError } from '../../../server/problem';
import { ownPurchase, purchaseView } from '../../../server/payments/checkout';
import { canBuyCredits, PROVIDER_NAMES } from '../../../server/payments/switches';
import { BUY_PATH } from '../../../server/payments/urls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your purchase',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Where a provider sends the buyer back: the purchase as it stands, followed until settled. */
export default async function ReturnPage({ searchParams }: Props) {
  const id = (await searchParams).purchase;
  if (typeof id !== 'string') notFound();
  const me = await currentUser();
  if (!me) redirect(`/sign-in?next=${encodeURIComponent(`/credits/return?purchase=${id}`)}`);
  let view;
  try {
    view = purchaseView(await ownPurchase(db(), me.user.id, id));
  } catch (error) {
    if (error instanceof ApiError) notFound();
    throw error;
  }
  const summary = `${view.credits.toLocaleString('en-US')} credits (${PACK_NAMES[view.pack_id]}) for ${formatMoney(view.amount_minor, view.currency)}`;

  return (
    <SiteFrame signedIn>
      <div className="mx-auto max-w-180 px-4 pt-8.5 pb-16 lg:px-0 lg:pt-15">
        <MonoLabel as="h1">Your purchase</MonoLabel>
        <div className="mt-6">
          <PurchaseProgress
            initial={view}
            provider={PROVIDER_NAMES[view.provider]}
            summary={summary}
            buyHref={(await canBuyCredits(db())) ? BUY_PATH : null}
          />
        </div>
      </div>
    </SiteFrame>
  );
}
