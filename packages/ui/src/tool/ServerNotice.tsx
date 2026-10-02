import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { Button } from '../primitives/Button';
import { MonoLabel } from '../primitives/MonoLabel';
import { Dialog } from '../primitives/overlays';
import { plural } from './format';
import { serverTerms, type ServerAccount, type ServerQuote, type ShellServer } from './server';

// A hybrid tool's server path in the ToolShell: the offer, the price check
// and its errors. The shell loads this file only for a tool whose server path
// is on (docs/10 → Budgets: script transfer on a tool page).
export { ServerRunError, serverTerms } from './server';

/**
 * The server offer (docs/02 → Routing): why the server, what it costs this
 * account, and where the file goes. The shell's primary button starts it;
 * this only explains. `account` is undefined while loading, null signed out.
 */
export function ServerNotice({
  server,
  reason,
  account,
  bytes,
  credits,
  className,
}: {
  server: ShellServer;
  reason: string;
  account: ServerAccount | null | undefined;
  bytes: number;
  credits: number | null;
  className?: string;
}) {
  const terms = account ? serverTerms(server, account, bytes, credits) : null;
  return (
    <div
      role="status"
      className={cn(
        'rounded-card border border-border px-4 py-3.5 text-14.5 leading-body',
        className,
      )}
    >
      <MonoLabel>Our servers</MonoLabel>
      <p className="mt-2">{reason}</p>
      {account === undefined ? (
        <p className="mt-2 text-text-muted">Checking your account…</p>
      ) : account === null ? (
        <p className="mt-2">
          Server processing needs an account; browser tools work without one.{' '}
          <AppLink href={server.signInHref} className="link-accent">
            Sign in
          </AppLink>
          , then add the file again.
        </p>
      ) : (
        <p className="mt-2 font-strong">
          {terms?.line}
          {terms?.needsCredits && account.buyHref && (
            <>
              {' '}
              <AppLink href={account.buyHref} className="link-accent font-normal">
                Buy credits
              </AppLink>
            </>
          )}
        </p>
      )}
      <p className="mt-2 text-13.5 text-text-muted">
        Your file is uploaded, then deleted as soon as the job ends; the result within 1 hour.
      </p>
    </div>
  );
}

/** The server's price, when it differs from the offer: start, or not now. */
export function PriceDialog({
  quote,
  answer,
}: {
  quote: ServerQuote;
  answer: (go: boolean) => void;
}) {
  return (
    <Dialog
      open
      onClose={() => {
        answer(false);
      }}
      title="Confirm the price"
    >
      <p className="text-15.5 leading-body">
        {quote.funding === 'credits'
          ? `Our servers checked the file: this costs ${plural(quote.credits, 'credit')}. You have ${String(quote.balance)}.`
          : 'Our servers checked the file: this one is free.'}
      </p>
      <p className="mt-2 text-14 text-text-muted">
        Credits are only kept if it succeeds; a failed job gives them back.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          variant="primary"
          onClick={() => {
            answer(true);
          }}
        >
          Start · {plural(quote.credits, 'credit')}
        </Button>
        <Button
          onClick={() => {
            answer(false);
          }}
        >
          Not now
        </Button>
      </div>
    </Dialog>
  );
}
