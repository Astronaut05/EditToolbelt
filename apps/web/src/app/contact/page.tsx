import type { Metadata } from 'next';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Contact | EditToolbelt',
  description: 'How to reach EditToolbelt: questions, abuse reports and privacy requests.',
  path: '/contact',
});

/** Inlined at build time (next.config.ts); empty until the address is set. */
const address = process.env.CONTACT_EMAIL;

export default function ContactPage() {
  return (
    <SiteFrame>
      <LegalPage title="Contact" label="Contact">
        {address ? (
          <p>
            Write to <a href={`mailto:${address}`}>{address}</a> with questions, problems or ideas.
            We read every message.
          </p>
        ) : (
          <p>The contact address is being set up and will be published on this page.</p>
        )}
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
