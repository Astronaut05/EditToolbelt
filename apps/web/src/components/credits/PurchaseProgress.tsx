'use client';

import { useEffect, useState } from 'react';

import { ButtonLink, StatePanel } from '@etb/ui';

import { SETTLED, type PurchaseView } from '../../lib/checkout';

/** How often, and for how long, the page asks while the provider hasn't confirmed. */
const POLL_MS = 2000;
const GIVE_UP_MS = 3 * 60 * 1000;

interface Props {
  initial: PurchaseView;
  provider: string;
  /** What the pack cost and what it gives, in words: "700 credits for $15.00". */
  summary: string;
  /** /credits/buy while credits are on sale, else null. */
  buyHref: string | null;
}

/**
 * /credits/return: follows a purchase until the provider's call to our
 * server settles it, then says what happened. Arriving here never adds
 * credits by itself (docs/11 → Payments).
 */
export function PurchaseProgress({ initial, provider, summary, buyHref }: Props) {
  const [view, setView] = useState(initial);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (SETTLED.includes(view.status) || gaveUp) return;
    const started = Date.now();
    let live = true;
    const timer = setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      void fetch(`/api/v1/credits/purchases/${encodeURIComponent(view.id)}`, {
        credentials: 'same-origin',
      })
        .then((response) => (response.ok ? (response.json() as Promise<PurchaseView>) : null))
        .then((fresh) => {
          if (live && fresh) setView(fresh);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [view.id, view.status, gaveUp]);

  const again = buyHref && (
    <ButtonLink href={buyHref} variant="primary">
      Try again
    </ButtonLink>
  );
  const account = (
    <ButtonLink href="/account" variant={again ? 'secondary' : 'primary'}>
      Your account
    </ButtonLink>
  );

  return (
    <div aria-live="polite">
      {view.status === 'completed' ? (
        <StatePanel
          label="Paid"
          title="Credits added"
          body={`${summary}. They’re on your account now and never expire.`}
          actions={account}
        />
      ) : view.status === 'cancelled' ? (
        <StatePanel
          tone="danger"
          label="Cancelled"
          title="The payment didn’t go through"
          body={`${provider} cancelled it, so nothing was charged and no credits were added.`}
          actions={
            <>
              {again}
              {account}
            </>
          }
        />
      ) : view.status === 'pending' ? (
        <StatePanel
          label={gaveUp ? 'Still waiting' : 'Waiting'}
          title={gaveUp ? `${provider} hasn’t confirmed yet` : `Waiting for ${provider} to confirm`}
          body={
            gaveUp
              ? 'If you paid, the credits arrive as soon as it confirms, even with this page closed. Your account shows the purchase.'
              : `${summary}. This usually takes a few seconds; you can close this page, the credits arrive either way.`
          }
          actions={gaveUp ? account : undefined}
        />
      ) : (
        <StatePanel
          label="Refunded"
          title="This purchase was refunded"
          body="Its credits came off your balance. Your account lists every purchase."
          actions={account}
        />
      )}
    </div>
  );
}
