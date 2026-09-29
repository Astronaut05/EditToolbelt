import type { Metadata } from 'next';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Terms | EditToolbelt',
  description:
    'The rules for using EditToolbelt: your files stay yours, what you may not do, and how credits work.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <SiteFrame>
      <LegalPage title="Terms">
        <p>
          This is a working draft. The final terms are reviewed by a lawyer before EditToolbelt
          takes its first payment.
        </p>
        <h2>The service</h2>
        <p>
          EditToolbelt is a set of tools for editing photos, video, audio and subtitles. Browser
          tools run on your device and are free. Server tools, added later, run on our servers and
          use credits.
        </p>
        <h2>Your files</h2>
        <ul>
          <li>You keep every right to what you process.</li>
          <li>You confirm you have the rights to process it.</li>
          <li>We process it only to give you the result, and never use it for training.</li>
        </ul>
        <h2>Not allowed</h2>
        <ul>
          <li>
            Illegal content, including any child sexual abuse material, which we report to the
            authorities.
          </li>
          <li>
            Content that infringes someone else’s rights, malware, and harassing or doxxing people.
          </li>
          <li>
            Overloading, scraping or reverse-engineering the service, or reselling it through
            automated access.
          </li>
        </ul>
        <h2>Credits</h2>
        <p>
          Credits pay for server tools. They don’t expire, can’t be transferred and have no cash
          value. Refunds are described on the <a href="/refunds">Refunds</a> page.
        </p>
        <h2>Age</h2>
        <p>You need to be 16 or older to use accounts and credits.</p>
      </LegalPage>
    </SiteFrame>
  );
}
