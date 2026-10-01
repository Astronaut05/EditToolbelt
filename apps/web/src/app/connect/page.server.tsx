import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Button, Input } from '@etb/ui';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { currentUser } from '../../server/account';
import { listKeys, MAX_KEYS, SCOPE_LABELS } from '../../server/api-keys';
import { formatUserCode, normalizeUserCode, pendingRequest } from '../../server/device';
import { approveDevice, declineDevice } from './actions';

export const metadata: Metadata = {
  title: 'Connect the panel',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Connect the Premiere panel (docs/06 → Auth): the person types the code the
 * panel shows (or follows its link), sees what it asks for, and approves.
 */
export default async function ConnectPage({ searchParams }: Props) {
  const params = await searchParams;
  const typed = one(params.code) ?? '';
  const me = await currentUser();
  if (!me) {
    const back = typed ? `/connect?code=${encodeURIComponent(typed)}` : '/connect';
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }
  const code = typed ? normalizeUserCode(typed) : null;
  const request = code ? await pendingRequest(code) : null;
  const full = request ? (await listKeys(me.user.id)).length >= MAX_KEYS : false;

  return (
    <SiteFrame signedIn>
      <LegalPage title="Connect the panel" label="Account">
        {params.done === 'approved' && (
          <p role="status">
            Connected. Go back to Premiere: the panel picks up its key within a few seconds. You can
            revoke it any time in{' '}
            <a href="/account#api-keys" className="underline underline-offset-4">
              Account → API keys
            </a>
            .
          </p>
        )}
        {params.done === 'declined' && <p role="status">Declined. The panel gets no key.</p>}
        {(params.gone === '1' || (typed && !request)) && (
          <p role="alert">
            That code is wrong or has expired (codes last 10 minutes). Start connecting again in the
            panel.
          </p>
        )}

        {request && code ? (
          <>
            <h2>
              Connect “{request.clientName}” to {me.user.email}?
            </h2>
            <p>
              Code <span className="font-mono">{formatUserCode(code)}</span>. Only go on if you just
              started connecting in the panel yourself and it shows this code.
            </p>
            <p>It gets its own API key, which can:</p>
            <ul>
              {request.scopes.map((scope) => (
                <li key={scope}>{SCOPE_LABELS[scope]}</li>
              ))}
            </ul>
            {full ? (
              <p role="alert">
                You have {MAX_KEYS} API keys, the most an account can have. Revoke one in{' '}
                <a href="/account#api-keys" className="underline underline-offset-4">
                  Account → API keys
                </a>
                , then come back to this page.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <form action={approveDevice}>
                  <input type="hidden" name="code" value={code} />
                  <Button type="submit" variant="primary">
                    Connect
                  </Button>
                </form>
                <form action={declineDevice}>
                  <input type="hidden" name="code" value={code} />
                  <Button type="submit">Decline</Button>
                </form>
              </div>
            )}
          </>
        ) : (
          !params.done && (
            <form method="get" action="/connect" className="flex max-w-md flex-col gap-3">
              <label htmlFor="code" className="text-14 font-strong">
                The code the panel shows
              </label>
              <Input
                id="code"
                name="code"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="BCDF-GHJK"
                defaultValue={typed}
                className="font-mono"
              />
              <Button type="submit" variant="primary" className="self-start">
                Continue
              </Button>
            </form>
          )
        )}
      </LegalPage>
    </SiteFrame>
  );
}
