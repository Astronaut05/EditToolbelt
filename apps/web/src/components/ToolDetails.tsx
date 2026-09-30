import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { AppLink, NumberedList } from '@etb/ui';

import type { RelatedLink } from '../lib/tool';

/**
 * Below the tool (docs/09 → Page template): how-to, why use this, FAQ,
 * related tools and the category link. Each section is a hairline row whose
 * heading sits in the tool's settings column, so the split line carries on.
 */
export function ToolDetails({
  name,
  about,
  howTo,
  why,
  faq,
  conversions = [],
  related,
  category,
}: {
  name: string;
  /** Conversion pair pages: what the formats are and what changes. */
  about?: { title: string; paragraphs: string[] };
  howTo: string[];
  why: string[];
  faq: { q: string; a: string }[];
  /** Conversion pair pages of this tool, or its sibling pairs. */
  conversions?: RelatedLink[];
  related: RelatedLink[];
  category: { href: string; title: string; count: number };
}) {
  return (
    <div className="border-t border-border">
      {about && (
        <Section id="about" title={about.title}>
          <div className="space-y-4 text-15.5 leading-prose">
            {about.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </Section>
      )}
      <Section id="how-to" title={`How to use the ${name}`}>
        <NumberedList variant="prose" items={howTo} />
      </Section>
      <Section id="why" title="Why use this">
        <ul className="border-t border-border">
          {why.map((line) => (
            <li key={line} className="border-b border-border py-3.5 text-15.5 leading-body">
              {line}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="faq" title="Questions">
        <div className="border-t border-border">
          {faq.map((item) => (
            <div key={item.q} className="border-b border-border py-4.5">
              <h3 className="text-17 font-strong">{item.q}</h3>
              <p className="mt-2 text-15.5 leading-prose text-text-muted">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>
      {conversions.length > 0 && (
        <Section id="conversions" title="Conversions">
          <LinkRows links={conversions} />
        </Section>
      )}
      <Section id="related" title="Related tools">
        <LinkRows
          links={[
            ...related,
            {
              href: category.href,
              name: category.title,
              summary: `All ${String(category.count)} tools in this category`,
            },
          ]}
        />
      </Section>
    </div>
  );
}

function LinkRows({ links }: { links: RelatedLink[] }) {
  return (
    <ul className="border-t border-border">
      {links.map((link) => (
        <li key={link.href} className="border-b border-border">
          <AppLink
            href={link.href}
            className="group flex min-h-15.5 items-center justify-between gap-4 py-3"
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
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="border-b border-border px-4 py-10 last:border-b-0 lg:grid lg:grid-cols-[var(--tool-left-col)_1fr] lg:px-0 lg:py-14"
    >
      <h2
        id={id}
        className="text-24 leading-title font-display tracking-title text-balance lg:px-10"
      >
        {title}
      </h2>
      <div className="mt-5 max-w-180 lg:mt-0 lg:px-10">{children}</div>
    </section>
  );
}
