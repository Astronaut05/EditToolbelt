import { Fragment } from 'react';

import { AppLink } from './AppLink';

export interface Crumb {
  label: string;
  href?: string;
}

/** Mono label breadcrumb: "PHOTO / REMOVE BACKGROUND". The last item is the current page. */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2.5 font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
        {items.map((item, index) => (
          <Fragment key={`${item.label}-${String(index)}`}>
            {index > 0 && (
              <li aria-hidden="true" className="select-none">
                /
              </li>
            )}
            <li>
              {item.href && index < items.length - 1 ? (
                <AppLink href={item.href} className="hover:text-text">
                  {item.label}
                </AppLink>
              ) : (
                <span aria-current={index === items.length - 1 ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
