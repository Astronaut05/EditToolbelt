import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { MonoLabel } from '../primitives/MonoLabel';
import { serverTerms, type ServerAccount, type ShellServer } from './server';

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
