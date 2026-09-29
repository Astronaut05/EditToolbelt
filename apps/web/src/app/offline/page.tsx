import type { Metadata } from 'next';

import { ButtonLink, MonoLabel } from '@etb/ui';

import { SiteFrame } from '../../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
};

/** Shown by the service worker when a page isn't cached and there's no network. */
export default function OfflinePage() {
  return (
    <SiteFrame>
      <div className="px-4 pt-10 pb-10 lg:px-10 lg:pt-15">
        <MonoLabel size="md">No connection</MonoLabel>
        <h1 className="mt-4.5 max-w-3xl text-46 leading-display-xl font-display tracking-display-xl lg:text-72">
          You’re offline
        </h1>
        <p className="mt-4.5 max-w-xl text-16.5 text-text-muted">
          Pages you’ve opened before still load. Reconnect to open this one.
        </p>
        <div className="mt-7 flex gap-3">
          <ButtonLink href="/" variant="primary">
            Home
          </ButtonLink>
        </div>
      </div>
    </SiteFrame>
  );
}
