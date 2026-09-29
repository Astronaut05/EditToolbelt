import type { CategoryId } from '@etb/registry';
import { Footer, Header } from '@etb/ui';
import type { ReactNode } from 'react';

const YEAR = new Date().getFullYear();

/** Header, main and footer around every page. `current` marks the category in the nav. */
export function SiteFrame({
  current,
  children,
  footer = true,
}: {
  current?: CategoryId;
  children: ReactNode;
  footer?: boolean;
}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 bg-bg px-4 py-3 text-14 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Header current={current} />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      {footer && <Footer year={YEAR} />}
    </>
  );
}
