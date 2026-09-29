'use client';

import { Menu } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { Dialog } from '../primitives/overlays';
import { ThemeToggle } from '../primitives/ThemeToggle';

export interface NavItem {
  href: string;
  label: string;
  current?: boolean;
}

/** Phone header menu: categories, sign in and theme in a bottom sheet. */
export function MobileMenu({ items, signInHref }: { items: NavItem[]; signInHref: string }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="inline-flex size-11 items-center justify-center text-text"
      >
        <Menu aria-hidden="true" size={20} strokeWidth={1.6} />
        <span className="sr-only">Menu</span>
      </button>
      <Dialog open={open} onClose={close} title="Menu" variant="sheet">
        <nav aria-label="Categories">
          <ul className="border-t border-border">
            {items.map((item) => (
              <li key={item.href}>
                <AppLink
                  href={item.href}
                  onClick={close}
                  aria-current={item.current ? 'page' : undefined}
                  className={cn(
                    'flex h-12 items-center border-b border-border text-16',
                    item.current ? 'font-strong text-text' : 'text-text',
                  )}
                >
                  <span className={cn(item.current && 'underline-accent')}>{item.label}</span>
                </AppLink>
              </li>
            ))}
            <li>
              <AppLink
                href={signInHref}
                onClick={close}
                className="flex h-12 items-center border-b border-border text-16 font-medium"
              >
                Sign in
              </AppLink>
            </li>
          </ul>
        </nav>
        <div className="mt-4 flex items-center justify-between">
          <span className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            Theme
          </span>
          <ThemeToggle />
        </div>
      </Dialog>
    </>
  );
}
