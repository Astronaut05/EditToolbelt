import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AppLink, Button, Input, StatePanel } from '@etb/ui';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { currentUser } from '../../server/account';
import { googleEnabled } from '../../server/auth';
import { safeNext } from '../../server/next-path';
import { continueWithGoogle, sendSignInLink } from './actions';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
  alternates: { canonical: '/sign-in' },
};

/** What a sign-in error code from the form or Better Auth means, in plain words. */
const ERRORS: Record<string, string> = {
  invalid_email: 'Enter your email address, like name@example.com.',
  send_failed: 'We couldn’t send the email just now. Try again in a minute.',
  TOO_MANY_LINKS: 'That’s three links in 15 minutes. Use the newest one, or try again later.',
  INVALID_TOKEN: 'That link has expired or was already used. Ask for a new one below.',
  EXPIRED_TOKEN: 'That link has expired or was already used. Ask for a new one below.',
  ACCOUNT_DISABLED: 'This account is disabled. Write to us if you think that’s a mistake.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Sign-in for the server build: a magic link by email, or Google when it's set up. */
export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNext(one(params.next));
  if (await currentUser()) redirect(next);
  const error = one(params.error);
  const sent = one(params.sent) === '1';
  const deleted = one(params.deleted) === '1';

  return (
    <SiteFrame>
      <LegalPage title="Sign in" label="Accounts">
        {deleted && (
          <p role="status">
            Your account is deleted. Sign in within 30 days to restore it; after that your email is
            erased for good.
          </p>
        )}
        {error && (
          <p role="alert" className="flex items-baseline gap-2.5">
            <span aria-hidden="true" className="size-2 flex-none rounded-full bg-danger" />
            {ERRORS[error] ?? 'Sign-in didn’t work. Try again.'}
          </p>
        )}
        {sent ? (
          <StatePanel
            label="Email sent"
            title="Check your email"
            body="We sent you a link to sign in. It works once, for 15 minutes. Nothing there? Look in spam, or ask for another."
            actions={
              <AppLink href="/sign-in" className="text-16 underline underline-offset-4">
                Use a different email
              </AppLink>
            }
          />
        ) : (
          <>
            <p>
              No password: we email you a link, and it signs you in. Every browser tool works
              without an account.
            </p>
            <form action={sendSignInLink} className="flex max-w-md flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="email" className="text-14 font-strong">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="name@example.com"
              />
              <Button type="submit" variant="primary">
                Email me a link
              </Button>
            </form>
            {googleEnabled() && (
              <form action={continueWithGoogle} className="max-w-md">
                <input type="hidden" name="next" value={next} />
                <Button type="submit" className="w-full">
                  Continue with Google
                </Button>
              </form>
            )}
            <p className="text-14 text-text-muted">
              By signing in you agree to the <AppLink href="/terms">Terms</AppLink> and the{' '}
              <AppLink href="/privacy">Privacy policy</AppLink>. Your email is the only personal
              detail we keep.
            </p>
          </>
        )}
      </LegalPage>
    </SiteFrame>
  );
}
