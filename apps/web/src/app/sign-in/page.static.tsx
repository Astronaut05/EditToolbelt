import type { Metadata } from 'next';

import { ButtonLink } from '@etb/ui';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
  alternates: { canonical: '/sign-in' },
};

export default function SignInPage() {
  return (
    <SiteFrame>
      <LegalPage title="Sign in" label="Accounts">
        <p>
          Accounts arrive with credits and server tools. Every browser tool works without one: no
          sign-up, and your files never leave your device.
        </p>
        <div className="flex gap-3 pt-2">
          <ButtonLink href="/" variant="primary">
            Find a tool
          </ButtonLink>
        </div>
      </LegalPage>
    </SiteFrame>
  );
}
