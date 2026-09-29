import type { Metadata } from 'next';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Refunds',
  description:
    'When credits come back automatically, and how to ask for a refund of a credit pack.',
  alternates: { canonical: '/refunds' },
};

export default function RefundsPage() {
  return (
    <SiteFrame>
      <LegalPage title="Refunds">
        <p>
          This is a working draft. Credit packs aren’t on sale yet; this page gets its final text
          before they are.
        </p>
        <h2>Failed jobs</h2>
        <p>
          If a server job fails, its credits return to your balance automatically. You don’t need to
          ask, and the result screen says “Credits returned”.
        </p>
        <h2>Credit packs</h2>
        <p>
          Unused credit packs can be refunded; the exact window and conditions are set before packs
          go on sale. Payments are handled by our reseller, who issues the refund to the original
          payment method.
        </p>
      </LegalPage>
    </SiteFrame>
  );
}
