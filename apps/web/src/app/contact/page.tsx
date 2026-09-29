import type { Metadata } from 'next';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach EditToolbelt: questions, abuse reports and privacy requests.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <SiteFrame>
      <LegalPage title="Contact" label="Contact">
        <p>
          EditToolbelt isn’t public yet. The contact address is published here when the site goes
          live on its own domain.
        </p>
        <h2 id="abuse">Report abuse</h2>
        <p>
          Reports about illegal content or misuse go to the same address, with “Abuse” in the
          subject. We act on them and, where the law requires, report to the authorities.
        </p>
        <h2 id="privacy">Privacy requests</h2>
        <p>
          Ask for a copy of your data, a correction or deletion at the same address, with “Privacy”
          in the subject. We answer within one month.
        </p>
      </LegalPage>
    </SiteFrame>
  );
}
