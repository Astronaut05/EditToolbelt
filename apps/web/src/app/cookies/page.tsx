import type { Metadata } from 'next';

import { THEME_STORAGE_KEY } from '@etb/ui';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { pageMetadata } from '../../lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Cookies | EditToolbelt',
  description:
    'EditToolbelt uses no tracking cookies. Every cookie and storage item the site uses, and why.',
  path: '/cookies',
});

export default function CookiesPage() {
  return (
    <SiteFrame>
      <LegalPage title="Cookies">
        <p>
          No tracking cookies, no ads, no third-party pixels. Everything below is strictly necessary
          for a feature you use, so there’s no consent banner.
        </p>
        <div className="overflow-x-auto">
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
                <td>
                  Keeps the site, processing code and AI models on your device so tools start fast,
                  and holds files shared to us from another app until a tool opens them
                </td>
                <td>Until you clear it; shared files an hour at most</td>
              </tr>
              <tr>
                <td>
                  <code>etb.session_token</code>
                </td>
                <td>Cookie</td>
                <td>Keeps you signed in</td>
                <td>30 days, renewed as you use the site; gone when you sign out</td>
              </tr>
              <tr>
                <td>
                  <code>etb.state</code>
                </td>
                <td>Cookie</td>
                <td>
                  Signing in with Google: checks the answer belongs to the sign-in you started
                </td>
                <td>5 minutes</td>
              </tr>
              <tr>
                <td>
                  <code>etb.two_factor</code>
                </td>
                <td>Cookie</td>
                <td>Admin accounts only: between signing in and the two-factor code</td>
                <td>10 minutes</td>
              </tr>
              <tr>
                <td>
                  <code>etb.admin_2fa</code>
                </td>
                <td>Cookie</td>
                <td>Admin pages only: this browser passed the two-factor check</td>
                <td>12 hours</td>
              </tr>
              <tr>
                <td>
                  <code>CF_Authorization</code>
                </td>
                <td>Cookie, set by Cloudflare Access</td>
                <td>While the site is private: proves you passed Access’s sign-in</td>
                <td>Access’s session, set in Cloudflare</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Every cookie is first-party, sent only over HTTPS and not readable by scripts on the page.
          None of them tracks you or is shared with anyone.
        </p>
      </LegalPage>
    </SiteFrame>
  );
}
