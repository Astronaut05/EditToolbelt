import type { Metadata } from 'next';

import register from '../../../../../licenses.json';
import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Open-source licenses | EditToolbelt',
  description: 'The open-source software and models EditToolbelt is built on, with their licenses.',
  path: '/licenses',
});

interface Entry {
  label: string;
  section: string;
  license: string;
  use: string;
  scope?: string;
  status: string;
  source?: string;
  /** LGPL parts we ship as their own file: where their source is offered. */
  sourceOffer?: string;
}

// Generated from the license register (licenses.json, docs/13-licenses.md):
// what ships to the browser or runs on our machines. Build tools are left out.
// Conditional entries show once they ship, which is when they carry a source offer.
const shipped = (register.entries as Entry[]).filter(
  (entry) => (entry.status === 'approved' || Boolean(entry.sourceOffer)) && entry.scope !== 'dev',
);
const sections = [...new Set(shipped.map((entry) => entry.section))];

export default function LicensesPage() {
  return (
    <SiteFrame>
      <LegalPage title="Open-source licenses" label="Credits">
        <p>
          EditToolbelt is built on open-source software. This list is generated from our license
          register and grows as tools go live. No GPL code ships to your browser; LGPL parts are
          separate files, with a link to their source.
        </p>
        {sections.map((section) => (
          <section key={section}>
            <h2>{section}</h2>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>License</th>
                  <th>Used for</th>
                </tr>
              </thead>
              <tbody>
                {shipped
                  .filter((entry) => entry.section === section)
                  .map((entry) => (
                    <tr key={entry.label}>
                      <td>
                        {entry.source ? <a href={entry.source}>{entry.label}</a> : entry.label}
                      </td>
                      <td>
                        <code>{entry.license}</code>
                      </td>
                      <td>
                        {entry.use}
                        {entry.sourceOffer && (
                          <>
                            {' '}
                            It includes LGPL code, loaded as a separate file you can replace;{' '}
                            <a href={entry.sourceOffer}>get its source code</a>.
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </LegalPage>
    </SiteFrame>
  );
}
