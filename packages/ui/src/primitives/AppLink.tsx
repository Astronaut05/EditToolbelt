import NextLink from 'next/link';
import type { ComponentProps } from 'react';

import { needsFullPageLoad } from '@etb/registry/isolated';

export type AppLinkProps = Omit<ComponentProps<'a'>, 'href'> & {
  href: string;
  prefetch?: boolean;
};

/**
 * Every internal link. Soft (client-side) navigation by default; a plain <a>
 * (full page load) for external links and for routes that need cross-origin
 * isolation, which a soft navigation can't switch on (docs/01).
 */
export function AppLink({ href, prefetch, ...rest }: AppLinkProps) {
  const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
  if (external || href.startsWith('#') || needsFullPageLoad(href)) {
    return <a href={href} {...rest} />;
  }
  return <NextLink href={href} prefetch={prefetch} {...rest} />;
}
