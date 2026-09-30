import type { ReactNode } from 'react';

import { MonoLabel } from '@etb/ui';

import { SiteFrame } from '../SiteFrame';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/tools', label: 'Tools' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/audit', label: 'Audit log' },
  { href: '/admin/system', label: 'System' },
];

/**
 * The admin's frame (docs/07: "a tool for one person, plain, dense, fast"):
 * the site's header and footer, a row of section links, then the page.
 */
export function AdminFrame({
  title,
  current,
  children,
}: {
  title: string;
  current: string;
  children: ReactNode;
}) {
  return (
    <SiteFrame signedIn>
      <div className="px-4 pt-6 pb-16 lg:px-10">
        <nav
          aria-label="Admin"
          className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-3"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.href === current ? 'page' : undefined}
              className="text-14 text-text-muted hover:text-text aria-[current=page]:text-text aria-[current=page]:underline aria-[current=page]:underline-offset-4"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <MonoLabel className="mt-6 block">Admin</MonoLabel>
        <h1 className="mt-2 text-34 leading-display font-display tracking-display">{title}</h1>
        <div className="mt-6 flex flex-col gap-8">{children}</div>
      </div>
    </SiteFrame>
  );
}

/** A section: a heading and what's under it. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-22 font-display tracking-display">{title}</h2>
      {children}
    </section>
  );
}

/** A plain table that scrolls sideways on phones instead of squeezing. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-14 tabular-nums">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="px-2 py-2 font-mono text-12 font-normal uppercase tracking-meta text-text-muted"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-2 [&_td]:align-top">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** Label and value pairs. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-14">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A required reason field for every admin write (docs/07). */
export function ReasonField({ id = 'reason' }: { id?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-14">
      <span className="font-strong">Reason (goes into the audit log)</span>
      <input
        id={id}
        name="reason"
        required
        minLength={3}
        maxLength={500}
        className="h-11 rounded-control border border-border bg-bg px-3 text-16"
      />
    </label>
  );
}

export const when = (date: Date | null | undefined) =>
  date ? `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC` : 'never';
