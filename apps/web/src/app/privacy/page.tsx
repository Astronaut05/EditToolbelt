import type { Metadata } from 'next';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Privacy | EditToolbelt',
  description:
    'What EditToolbelt collects, why, and for how long. Browser tools never send your files anywhere.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <SiteFrame>
      <LegalPage title="Privacy">
        <p>
          This is a working draft. The final policy is reviewed by a lawyer before EditToolbelt
          takes its first payment, and it will name the company, the contact address and every
          processor.
        </p>
        <h2>The short version</h2>
        <ul>
          <li>Browser tools process your files on your device. They never reach us.</li>
          <li>
            Server tools (AI jobs, later) delete your input when the job ends and the result within
            1 hour.
          </li>
          <li>
            We use no tracking cookies, no ads and no third-party pixels. Analytics are cookieless
            and aggregate.
          </li>
          <li>We never use your files to train models.</li>
        </ul>
        <h2>What we keep</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Why</th>
              <th>How long</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Email and account (once accounts exist)</td>
              <td>Sign-in, receipts</td>
              <td>Until you delete the account, plus 30 days</td>
            </tr>
            <tr>
              <td>Files for server tools</td>
              <td>To run the job you asked for</td>
              <td>
                Input: until the job ends. Result: 1 hour. A storage backstop removes anything
                missed within 48 hours.
              </td>
            </tr>
            <tr>
              <td>Job metadata, never file contents</td>
              <td>Fixing failures, pricing</td>
              <td>90 days, then aggregated</td>
            </tr>
            <tr>
              <td>Server logs</td>
              <td>Security, debugging</td>
              <td>30 days at most</td>
            </tr>
          </tbody>
        </table>
        <h2>Cookies and storage</h2>
        <p>
          Only what the site needs to work. See <a href="/cookies">Cookies</a> for the full list.
        </p>
        <h2>Your rights</h2>
        <p>
          You can ask for a copy of your data, a correction or deletion, and object to processing.
          Accounts will have self-serve export and delete. Requests are answered within one month;
          see <a href="/contact#privacy">Contact</a>.
        </p>
      </LegalPage>
    </SiteFrame>
  );
}
