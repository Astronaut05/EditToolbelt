import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { qrMatrix, qrPaths, qrSvg } from '@etb/core/qr';
import { Button, Input } from '@etb/ui';

import { LegalPage } from '../../../components/LegalPage';
import { SiteFrame } from '../../../components/SiteFrame';
import { requireAdminAccount } from '../../../server/admin';
import { auth } from '../../../server/auth';
import { startSetup, verifyBackup, verifyCode } from './actions';

export const metadata: Metadata = {
  title: 'Admin two-factor',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const ERRORS: Record<string, string> = {
  code: 'That code didn’t work. Codes change every 30 seconds; use the current one.',
  locked: 'Five wrong codes in 15 minutes. Wait, then try again.',
};

/** The authenticator link as a QR code (our own generator), and its secret for typing in. */
function totpQr(uri: string): { src: string; secret: string } {
  const matrix = qrMatrix(uri, 'M');
  if (!matrix.ok) throw new Error(matrix.error);
  const svg = qrSvg(
    qrPaths(matrix.matrix, { margin: 4, dots: 'square', eyes: 'square', logo: 0 }),
    {
      px: 220,
      fg: '#000000',
      bg: '#FFFFFF',
    },
  );
  return {
    src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    secret: new URL(uri).searchParams.get('secret') ?? '',
  };
}

function CodeForm({ label }: { label: string }) {
  return (
    <form action={verifyCode} className="flex max-w-xs flex-col gap-3">
      <label htmlFor="code" className="text-14 font-strong">
        {label}
      </label>
      <Input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
      <Button type="submit" variant="primary">
        Continue
      </Button>
    </form>
  );
}

/** Admins pass a TOTP code before /admin opens (docs/07, docs/11); set it up here first. */
export default async function AdminTwoFactorPage({ searchParams }: Props) {
  const { user } = await requireAdminAccount();
  const error = (await searchParams).error;
  const message = typeof error === 'string' ? ERRORS[error] : undefined;

  if (user.twoFactorEnabled) {
    return (
      <SiteFrame signedIn>
        <LegalPage title="Two-factor check" label="Admin">
          {message && <p role="alert">{message}</p>}
          <p>
            Enter the 6-digit code from your authenticator app. It opens the admin for 12 hours.
          </p>
          <CodeForm label="Code" />
          <details>
            <summary>Use a backup code</summary>
            <form action={verifyBackup} className="mt-3 flex max-w-xs flex-col gap-3">
              <label htmlFor="backupCode" className="text-14 font-strong">
                Backup code
              </label>
              <Input id="backupCode" name="backupCode" autoComplete="off" required />
              <Button type="submit">Use it</Button>
            </form>
          </details>
        </LegalPage>
      </SiteFrame>
    );
  }

  const requestHeaders = await headers();
  const pending = await auth()
    .api.getTOTPURI({ body: {}, headers: requestHeaders })
    .catch(() => null);

  if (!pending) {
    return (
      <SiteFrame signedIn>
        <LegalPage title="Set up two-factor" label="Admin">
          <p>
            The admin needs a second step: a 6-digit code from an authenticator app (1Password,
            Bitwarden, Google Authenticator, Aegis and the like). Set it up once; after that it asks
            every 12 hours.
          </p>
          <form action={startSetup}>
            <Button type="submit" variant="primary">
              Set up two-factor
            </Button>
          </form>
        </LegalPage>
      </SiteFrame>
    );
  }

  const qr = totpQr(pending.totpURI);
  const backup = await auth().api.viewBackupCodes({ body: { userId: user.id } });
  return (
    <SiteFrame signedIn>
      <LegalPage title="Set up two-factor" label="Admin">
        {message && <p role="alert">{message}</p>}
        <p>1. Scan this with your authenticator app, or type the key in.</p>
        {/* A data: URL we generate; nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.src} width={220} height={220} alt="QR code for your authenticator app" />
        <p>
          Key: <span className="font-mono break-all">{qr.secret}</span>
        </p>
        <p>
          2. Keep these backup codes somewhere safe. Each works once, if you lose the app. They’re
          shown only while you set up.
        </p>
        <ul className="font-mono">
          {backup.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <CodeForm label="3. Enter the code the app shows" />
      </LegalPage>
    </SiteFrame>
  );
}
