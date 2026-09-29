import { ArrowRight } from 'lucide-react';

import { AppLink, Breadcrumb, NumberedList, StatusTag } from '@etb/ui';

export interface SoonLink {
  href: string;
  name: string;
  summary: string;
}

/**
 * Placeholder page for a `soon` tool (design: soon-upscale), `noindex`. Left:
 * what it will do. Right: a hatched panel with related tools that work today,
 * or the category hub while none do.
 */
export function ComingSoon({
  category,
  name,
  h1,
  tagline,
  willDo,
  tryLinks,
  panelLabel,
}: {
  category: { name: string; href: string };
  name: string;
  h1: string;
  tagline: string;
  willDo: string[];
  tryLinks: SoonLink[];
  panelLabel: string;
}) {
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-var(--header-h))] lg:grid-cols-[var(--tool-left-col)_1fr]">
      <div className="flex flex-col px-4 pt-5.5 pb-10 lg:border-r lg:border-border lg:px-10 lg:pt-8.5">
        <Breadcrumb items={[{ label: category.name, href: category.href }, { label: name }]} />
        <h1 className="mt-3 text-34 leading-display font-display tracking-display text-balance lg:mt-4.5 lg:text-46">
          {h1}
        </h1>
        <StatusTag className="mt-4.5">Coming soon</StatusTag>
        <p className="mt-4 text-15.5 leading-body text-text-muted lg:text-16.5">{tagline}</p>
        <h2 className="sr-only">What it will do</h2>
        <NumberedList variant="prose" items={willDo} className="mt-6.5" />
      </div>
      <div className="hatch relative px-4 py-8 lg:px-18 lg:py-18">
        <h2 className="font-mono text-12 font-medium uppercase tracking-label text-text-muted">
          {panelLabel}
        </h2>
        <ul className="mt-3.5 border border-border bg-bg">
          {tryLinks.map((link) => (
            <li key={link.href} className="border-b border-border last:border-b-0">
              <AppLink
                href={link.href}
                className="group flex min-h-15.5 items-center justify-between gap-4 px-5 py-3"
              >
                <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
                  <span className="text-17 font-strong group-hover:underline">{link.name}</span>
                  <span className="text-13.5 text-text-muted">{link.summary}</span>
                </span>
                <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} className="flex-none" />
              </AppLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
