import type { ReactNode } from 'react';

import { MonoLabel } from '@etb/ui';

/**
 * Legal and info pages: one 720 px text column, 46 px H1, body 16/1.6
 * (design README → Not drawn yet). Stubs until Go public; final text is
 * lawyer-reviewed before the first payment (docs/08).
 */
export function LegalPage({
  title,
  label = 'Draft',
  updated,
  children,
}: {
  title: string;
  label?: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-180 px-4 pt-8.5 lg:px-0 lg:pt-15">
      <MonoLabel>{label}</MonoLabel>
      <h1 className="mt-4.5 text-34 leading-display font-display tracking-display lg:text-46">
        {title}
      </h1>
      {updated && (
        <p className="mt-3 font-mono text-12 uppercase tracking-meta text-text-muted">
          Updated {updated}
        </p>
      )}
      <div className="prose-signal mt-8 text-16 leading-prose">{children}</div>
    </article>
  );
}
