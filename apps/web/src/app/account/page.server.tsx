import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { accounts, eq } from '@etb/db';
import { Button, CreditBadge, Input } from '@etb/ui';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { currentUser } from '../../server/account';
import { db } from '../../server/db';
import { deleteMyAccount, saveProfile, signOut, signOutEverywhere } from './actions';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const METHOD_NAMES: Record<string, string> = { google: 'Google' };

/** Account settings (server build): profile, sign-in, your data, deleting the account. */
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

  return (
    <SiteFrame>
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
        <p className="text-text-muted">
          Credits pay for server tools, which arrive later. Every browser tool is free.
        </p>

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
