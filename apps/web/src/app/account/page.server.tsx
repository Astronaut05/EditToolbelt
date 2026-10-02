import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { accounts, desc, eq, purchases } from '@etb/db';
import { Button, ButtonLink, CreditBadge, Input } from '@etb/ui';

import { NewKeyForm } from '../../components/account/NewKeyForm';
import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { currentUser } from '../../server/account';
import { listKeys, MAX_KEYS, SCOPE_LABELS, SCOPES } from '../../server/api-keys';
import { db } from '../../server/db';
import { canBuyCredits } from '../../server/payments/switches';
import { BUY_PATH } from '../../server/payments/urls';
import { requestTime } from '../../server/time';
import { formatMoney, packName } from '../../lib/money';
import { providerName } from '../../lib/pay-with';
import type { PurchaseStatus } from '../../server/payments/contract';
import {
  createApiKey,
  deleteMyAccount,
  revokeApiKey,
  saveProfile,
  signOut,
  signOutEverywhere,
} from './actions';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const METHOD_NAMES: Record<string, string> = { google: 'Google' };

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A checkout nobody finished within this long shows as "Not paid". Pending
 * purchases are never cancelled for age: Payme may still perform an order up
 * to 7 days old, and a late payment must find its purchase.
 */
const ABANDONED_MS = 7 * 24 * 60 * 60 * 1000;

function statusLabel(status: PurchaseStatus, createdAt: Date, now: number): string {
  switch (status) {
    case 'pending':
      return now - createdAt.getTime() > ABANDONED_MS ? 'Not paid' : 'Waiting for payment';
    case 'completed':
      return 'Paid';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partly refunded';
    case 'chargeback':
      return 'Disputed';
  }
}

/** Account settings (server build): profile, sign-in, API keys, your data, deleting the account. */
export default async function AccountPage({ searchParams }: Props) {
  const me = await currentUser();
  if (!me) redirect('/sign-in?next=/account');
  const { user } = me;
  const params = await searchParams;
  const linked = await db()
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, user.id));
  const methods = ['Email link', ...linked.map((a) => METHOD_NAMES[a.providerId] ?? a.providerId)];
  const keys = await listKeys(user.id);
  const [bought, canBuy] = await Promise.all([
    db()
      .select()
      .from(purchases)
      .where(eq(purchases.userId, user.id))
      .orderBy(desc(purchases.createdAt))
      .limit(100),
    canBuyCredits(db()),
  ]);
  const now = requestTime();

  return (
    <SiteFrame signedIn>
      <LegalPage title="Your account" label="Account">
        {params.saved === '1' && <p role="status">Saved.</p>}
        {params.error === 'profile' && (
          <p role="alert">Your name can be up to 80 characters. Nothing was saved.</p>
        )}

        <h2>Profile</h2>
        <form action={saveProfile} className="flex max-w-md flex-col gap-3">
          <p className="text-14 text-text-muted">
            Email <span className="block text-16 text-text">{user.email}</span>
          </p>
          <label htmlFor="displayName" className="text-14 font-strong">
            Name <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <Input
            id="displayName"
            name="displayName"
            maxLength={80}
            autoComplete="name"
            defaultValue={user.displayName ?? ''}
          />
          <label className="flex min-h-11 items-center gap-3 text-16">
            <input
              type="checkbox"
              name="marketingOptIn"
              defaultChecked={user.marketingOptIn}
              className="size-4.5 accent-(--accent)"
            />
            Email me when new tools arrive (a few times a year)
          </label>
          <Button type="submit" variant="primary" className="self-start">
            Save
          </Button>
        </form>

        <h2>Credits</h2>
        <p>
          <CreditBadge credits={user.creditBalance} />
        </p>
        {user.creditBalance < 0 && (
          <p>
            Your balance is below zero after a refunded pack. Paid server jobs start again once it’s
            topped up.
          </p>
        )}
        <p className="text-text-muted">
          Every browser tool is free. Our servers run a few small jobs a day for free; credits pay
          for the rest.
        </p>
        {canBuy && (
          <p>
            <ButtonLink href={BUY_PATH} variant="primary" size="md">
              Buy credits
            </ButtonLink>
          </p>
        )}

        {(bought.length > 0 || canBuy) && (
          <>
            <h2 id="purchases">Purchases</h2>
            {bought.length === 0 ? (
              <p className="text-text-muted">No purchases yet.</p>
            ) : (
              <div
                role="region"
                aria-label="Your purchases"
                tabIndex={0}
                className="overflow-x-auto"
              >
                <table className="w-full min-w-max border-collapse text-14 tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['Date', 'Pack', 'Credits', 'Amount', 'Status'].map((cell) => (
                        <th
                          key={cell}
                          scope="col"
                          className="py-2 pr-4 font-mono text-12 font-normal uppercase tracking-meta text-text-muted"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-b [&_td]:border-border [&_td]:py-2 [&_td]:pr-4">
                    {bought.map((purchase) => (
                      <tr key={purchase.id}>
                        <td>{day.format(purchase.createdAt)}</td>
                        <td>
                          {packName(purchase.packId)}
                          <span className="text-text-muted">
                            {' '}
                            · {providerName(purchase.provider)}
                          </span>
                        </td>
                        <td>{purchase.credits.toLocaleString('en-US')}</td>
                        <td>{formatMoney(purchase.amountMinor, purchase.currency)}</td>
                        <td>{statusLabel(purchase.status, purchase.createdAt, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-14 text-text-muted">
              Receipts come from the payment provider by email.
            </p>
          </>
        )}

        <h2>Signing in</h2>
        <p>You sign in with: {methods.join(', ')}.</p>
        <div className="flex flex-wrap gap-3">
          <form action={signOut}>
            <Button type="submit">Sign out</Button>
          </form>
          <form action={signOutEverywhere}>
            <Button type="submit">Sign out everywhere</Button>
          </form>
        </div>

        <h2 id="api-keys">API keys</h2>
        <p>
          A key lets a script or the Premiere panel use our servers as you, from anywhere: keep it
          secret. Send it as <code className="font-mono">Authorization: Bearer etb_live_…</code>;{' '}
          <a href="/developers" className="underline underline-offset-4">
            the API docs
          </a>{' '}
          show the rest.
        </p>
        {params.revoked === '1' && <p role="status">The key is revoked. It stops working now.</p>}
        {keys.length === 0 ? (
          <p className="text-text-muted">No keys yet.</p>
        ) : (
          <ul aria-label="Your API keys" className="flex flex-col gap-3 pl-0">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex list-none flex-wrap items-center justify-between gap-3 rounded-card border border-border p-4"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-strong">{key.name}</span>
                  <span className="font-mono text-14 text-text-muted">{key.prefix}…</span>
                  <span className="text-14 text-text-muted">
                    {key.scopes.join(' · ')} · made {day.format(key.createdAt)} ·{' '}
                    {key.lastUsedAt ? `last used ${day.format(key.lastUsedAt)}` : 'never used'}
                  </span>
                </div>
                <form action={revokeApiKey}>
                  <input type="hidden" name="id" value={key.id} />
                  <Button type="submit" aria-label={`Revoke ${key.name}`}>
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {keys.length < MAX_KEYS ? (
          <NewKeyForm
            action={createApiKey}
            scopes={SCOPES.map((id) => ({ id, label: SCOPE_LABELS[id] }))}
          />
        ) : (
          <p className="text-text-muted">
            That’s {MAX_KEYS} keys, the most an account can have. Revoke one to make another.
          </p>
        )}

        <h2>Your data</h2>
        <p>
          One JSON file: your profile, purchases, credit history, the last 90 days of server jobs
          and your API keys by name. We keep no files, so there are none to download.
        </p>
        <p>
          <a href="/account/data" download className="underline underline-offset-4">
            Download my data
          </a>
        </p>

        <h2 id="delete">Delete your account</h2>
        <p>
          You’re signed out everywhere and your API keys stop working. For 30 days, signing in again
          restores the account; after that your email and name are erased for good. Purchase records
          stay for accounting, without your email. Unused credits are covered in the{' '}
          <a href="/terms" className="underline underline-offset-4">
            Terms
          </a>
          .
        </p>
        {params.error === 'confirm' && (
          <p role="alert">Type delete in the box to confirm. Nothing was deleted.</p>
        )}
        <form action={deleteMyAccount} className="flex max-w-md flex-col gap-3">
          <label htmlFor="confirm" className="text-14 font-strong">
            Type <span className="font-mono">delete</span> to confirm
          </label>
          <Input id="confirm" name="confirm" autoComplete="off" required />
          <Button type="submit" className="self-start">
            Delete my account
          </Button>
        </form>
      </LegalPage>
    </SiteFrame>
  );
}
