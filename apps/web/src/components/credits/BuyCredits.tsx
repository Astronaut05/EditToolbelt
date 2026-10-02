'use client';

import { useEffect, useState } from 'react';

import { Button, MonoLabel, SegmentedControl } from '@etb/ui';

import type { CheckoutAnswer } from '../../lib/checkout';
import { PADDLE_JS_URL } from '../../lib/paddle-js';
import type { PayWith } from '../../lib/pay-with';
import type { ProviderId } from '../../server/payments/contract';

export interface PackOffer {
  id: string;
  name: string;
  credits: number;
  /** Per provider: "$15.00", "189,000 UZS". */
  price: Record<string, string>;
  /** Per provider: "2.1¢ a credit". */
  perCredit: Record<string, string>;
}

interface PaddleJs {
  Environment: { set: (environment: 'sandbox') => void };
  Initialize: (options: {
    token: string;
    eventCallback?: (event: { name?: string }) => void;
  }) => void;
  Checkout: {
    open: (options: {
      transactionId: string;
      settings?: { displayMode?: 'overlay'; successUrl?: string };
    }) => void;
  };
}

let paddleReady: Promise<PaddleJs> | null = null;

/** Paddle.js, loaded once and only for the overlay (this page's CSP allows it). */
function loadPaddle(): Promise<PaddleJs> {
  paddleReady ??= new Promise<PaddleJs>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_JS_URL;
    script.async = true;
    script.onload = () => {
      const paddle = (window as unknown as { Paddle?: PaddleJs }).Paddle;
      if (paddle) resolve(paddle);
      else reject(new Error('Paddle.js did not start'));
    };
    script.onerror = () => {
      paddleReady = null;
      reject(new Error('Paddle.js did not load'));
    };
    document.head.append(script);
  });
  return paddleReady;
}

let paddleStarted = false;

/** A Paddle transaction to reopen: the buyer came from Paddle's payment link (`?_ptxn=`). */
export interface ResumePaddle {
  transactionId: string;
  purchaseId: string;
  clientToken: string;
  environment: 'sandbox' | 'production';
}

const returnPath = (purchaseId: string) =>
  `/credits/return?purchase=${encodeURIComponent(purchaseId)}`;

/** Opens Paddle's overlay for a transaction; Paddle.js starts once per page. */
async function openPaddle(
  overlay: { transactionId: string; clientToken: string; environment: 'sandbox' | 'production' },
  back: string,
): Promise<void> {
  const paddle = await loadPaddle();
  if (!paddleStarted) {
    if (overlay.environment === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({
      token: overlay.clientToken,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') window.location.assign(back);
      },
    });
    paddleStarted = true;
  }
  paddle.Checkout.open({
    transactionId: overlay.transactionId,
    settings: { displayMode: 'overlay', successUrl: new URL(back, window.location.href).href },
  });
}

interface Problem {
  title?: string;
  detail?: string;
}

/**
 * The provider choice and the packs (docs/05 → Packs). "Buy" makes a pending
 * purchase, then the browser goes to the provider's page in a full-page
 * navigation (or Paddle's overlay opens here). Credits arrive only from the
 * provider's own call to our server; /credits/return waits for it.
 */
export function BuyCredits({
  payWith,
  packs,
  resume = null,
}: {
  payWith: PayWith[];
  packs: PackOffer[];
  resume?: ResumePaddle | null;
}) {
  const [provider, setProvider] = useState<ProviderId>(payWith[0]?.id ?? 'paddle');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const chosen = payWith.find((option) => option.id === provider) ?? payWith[0];

  // Paddle's payment link: open that transaction once, and drop `_ptxn` so a
  // reload or Paddle.js itself doesn't open it twice.
  useEffect(() => {
    if (!resume) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('_ptxn');
    window.history.replaceState(null, '', url);
    openPaddle(resume, returnPath(resume.purchaseId)).catch(() => {
      setError({
        title: 'The payment page didn’t open',
        detail: 'Check your connection and reload. Nothing was charged.',
      });
    });
  }, [resume]);

  async function buy(packId: string) {
    setBusy(packId);
    setError(null);
    try {
      const response = await fetch('/api/v1/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pack_id: packId, provider }),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as Problem;
        setError(
          response.status === 401
            ? { title: 'You’re signed out', detail: 'Sign in again, then buy.' }
            : problem,
        );
        setBusy(null);
        return;
      }
      const answer = (await response.json()) as CheckoutAnswer;
      const back = returnPath(answer.purchase_id);
      if (answer.checkout.kind === 'redirect') {
        // A full-page navigation to the provider; it sends the buyer back to `back`.
        window.location.assign(answer.checkout.url);
        return;
      }
      await openPaddle(answer.checkout, back);
      setBusy(null);
    } catch {
      setError({
        title: 'The payment page didn’t open',
        detail: 'Check your connection and try again. Nothing was charged.',
      });
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {payWith.length > 1 && (
        <section aria-labelledby="pay-with" className="flex flex-col gap-2">
          <h2 id="pay-with" className="text-14 font-strong">
            Pay with
          </h2>
          <SegmentedControl
            label="Pay with"
            size="lg"
            options={payWith.map((option) => ({ value: option.id, label: option.name }))}
            value={provider}
            onChange={(value) => {
              setProvider(value);
              setError(null);
            }}
          />
        </section>
      )}
      {chosen && (
        <p className="text-14.5 text-text-muted">
          {payWith.length === 1 && <span className="font-strong text-text">{chosen.name}. </span>}
          {chosen.methods}
        </p>
      )}

      {error && (
        <div role="alert" className="flex gap-3 border-y border-border py-3.5 text-14">
          <span aria-hidden="true" className="mt-1.5 size-2 flex-none rounded-full bg-danger" />
          <div>
            <p className="font-strong">{error.title ?? 'That didn’t work'}</p>
            {error.detail && <p className="mt-0.5 text-text-muted">{error.detail}</p>}
          </div>
        </div>
      )}

      <ul aria-label="Credit packs" className="flex flex-col border-t border-border">
        {packs.map((pack) => (
          <li
            key={pack.id}
            className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 border-b border-border py-5 sm:grid-cols-[10rem_1fr_auto]"
          >
            <div className="flex flex-col">
              <MonoLabel>{pack.name}</MonoLabel>
              <span className="mt-1 font-display text-22 tracking-display tabular-nums">
                {pack.credits.toLocaleString('en-US')} credits
              </span>
            </div>
            <div className="col-start-1 flex flex-col sm:col-start-2">
              <span className="font-mono text-16 tabular-nums">{pack.price[provider]}</span>
              <span className="text-13.5 text-text-muted">{pack.perCredit[provider]}</span>
            </div>
            <Button
              variant="primary"
              size="md"
              className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1"
              disabled={busy !== null}
              aria-label={`Buy ${pack.name}: ${pack.credits.toLocaleString('en-US')} credits for ${pack.price[provider] ?? ''}`}
              onClick={() => {
                void buy(pack.id);
              }}
            >
              {busy === pack.id ? 'Opening…' : `Buy ${pack.name}`}
            </Button>
          </li>
        ))}
      </ul>
      <noscript>
        <p>Buying needs JavaScript: the payment page opens from here.</p>
      </noscript>
    </div>
  );
}
