import type { Metadata } from 'next';

import { THEME_STORAGE_KEY } from '@etb/ui';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Cookies',
  description:
    'EditToolbelt uses no tracking cookies. Every cookie and storage item the site uses, and why.',
  alternates: { canonical: '/cookies' },
};

export default function CookiesPage() {
  return (
    <SiteFrame>
      <LegalPage title="Cookies">
        <p>
          No tracking cookies, no ads, no third-party pixels. Everything below is strictly necessary
          for a feature you use, so there’s no consent banner.
        </p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Purpose</th>
              <th>Lifetime</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>{THEME_STORAGE_KEY}</code>
              </td>
              <td>localStorage</td>
              <td>Remembers light or dark, if you pick one</td>
              <td>Until you clear it</td>
            </tr>
            <tr>
              <td>Cache Storage</td>
              <td>Browser cache</td>
              <td>Keeps the site and processing code offline-ready so tools start fast</td>
              <td>Until you clear it</td>
            </tr>
          </tbody>
        </table>
        <p>
          Accounts (later) add a session cookie and a security token, both strictly necessary. This
          page lists them when they arrive.
        </p>
      </LegalPage>
    </SiteFrame>
  );
}
