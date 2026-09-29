import type { Metadata } from 'next';

import { ButtonLink, MonoLabel } from '@etb/ui';

import { SiteFrame } from '../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <SiteFrame>
      <div className="px-4 pt-10 pb-10 lg:px-10 lg:pt-15">
        <MonoLabel size="md">404</MonoLabel>
        <h1 className="mt-4.5 max-w-3xl text-46 leading-display-xl font-display tracking-display-xl lg:text-72">
          There’s no page here
        </h1>
        <p className="mt-4.5 max-w-xl text-16.5 text-text-muted">
          The link may be old, or the tool may have moved. Search for what you need, or start from a
          category.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href="/" variant="primary">
            Search tools
          </ButtonLink>
          <ButtonLink href="/photo">Photo tools</ButtonLink>
          <ButtonLink href="/video">Video tools</ButtonLink>
        </div>
      </div>
    </SiteFrame>
  );
}
