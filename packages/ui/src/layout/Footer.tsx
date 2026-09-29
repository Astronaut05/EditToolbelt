import { categories, categoryPath } from '@etb/registry';

import { AppLink } from '../primitives/AppLink';
import { MonoLabel } from '../primitives/MonoLabel';
import { ThemeToggle } from '../primitives/ThemeToggle';
import { Wordmark } from '../primitives/Wordmark';

const LEGAL = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/refunds', label: 'Refunds' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/licenses', label: 'Open-source licenses' },
];

const CONTACT = [
  { href: '/contact', label: 'Email us' },
  { href: '/contact#abuse', label: 'Report abuse' },
  { href: '/contact#privacy', label: 'Privacy requests' },
];

function Column({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  const id = `footer-${title.toLowerCase()}`;
  return (
    <nav aria-labelledby={id}>
      <MonoLabel as="h2" id={id} className="mb-3">
        {title}
      </MonoLabel>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <AppLink
              href={link.href}
              prefetch={false}
              className="flex h-7.5 items-start text-14.5 hover:underline"
            >
              {link.label}
            </AppLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Same footer on every page (design README → Category hub). */
export function Footer({ year }: { year: number }) {
  return (
    <footer className="mt-18 border-t border-border">
      <div className="grid gap-10 px-4 pt-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-10">
        <div>
          <Wordmark size="lg" />
          <p className="mt-3 max-w-90 text-14 leading-body text-text-muted">
            Quick tools for photo, video and audio editors. Browser tools are free, with no sign-up.
          </p>
          <div className="mt-6 flex items-center gap-4">
            <MonoLabel as="span">Theme</MonoLabel>
            <ThemeToggle />
          </div>
        </div>
        <Column
          title="Tools"
          links={categories.map((c) => ({ href: categoryPath(c), label: c.name }))}
        />
        <Column title="Legal" links={LEGAL} />
        <Column title="Contact" links={CONTACT} />
      </div>
      <div className="mx-4 mt-9 flex flex-wrap justify-between gap-2 border-t border-border pt-4.5 pb-7 font-mono text-12 uppercase tracking-meta text-text-muted lg:mx-10">
        <span>© {year} EditToolbelt</span>
        <span>No tracking cookies</span>
      </div>
    </footer>
  );
}
