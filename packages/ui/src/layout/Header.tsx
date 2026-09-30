import { categories, categoryPath, type CategoryId } from '@etb/registry';

import { cn } from '../cn';
import { AppLink } from '../primitives/AppLink';
import { Wordmark } from '../primitives/Wordmark';
import { MobileMenu } from './MobileMenu';
import { SearchButton } from './SearchOverlay';

export const SIGN_IN_PATH = '/sign-in';
export const ACCOUNT_PATH = '/account';

/**
 * Site header (design README → Header): wordmark, category nav with the
 * current one in --text, search, and "Sign in" after a hairline. 56 px on
 * desktop, 52 px with search and menu icons on phones. Pages that know the
 * visitor is signed in (account, admin) pass `signedIn` for "Account" instead.
 */
export function Header({
  current,
  signedIn = false,
}: {
  current?: CategoryId;
  signedIn?: boolean;
}) {
  const items = categories.map((category) => ({
    href: categoryPath(category),
    label: category.name,
    current: category.id === current,
  }));
  const account = signedIn
    ? { href: ACCOUNT_PATH, label: 'Account' }
    : { href: SIGN_IN_PATH, label: 'Sign in' };
  return (
    <header className="sticky top-0 z-30 h-13 border-b border-border bg-bg lg:h-(--header-h)">
      <div className="flex h-full items-center pr-1 pl-4 lg:gap-6.5 lg:px-10">
        <AppLink href="/" className="-my-2 py-2" aria-label="EditToolbelt home">
          <Wordmark />
        </AppLink>
        <nav aria-label="Categories" className="hidden lg:block">
          <ul className="flex gap-5.5 text-14">
            {items.map((item) => (
              <li key={item.href}>
                <AppLink
                  href={item.href}
                  aria-current={item.current ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-11 items-center transition-colors duration-(--dur-fast)',
                    item.current ? 'text-text' : 'text-text-muted hover:text-text',
                  )}
                >
                  {item.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto hidden items-center gap-6.5 lg:flex">
          <SearchButton />
          <AppLink
            href={account.href}
            className="border-l border-border pl-5.5 text-14 font-medium hover:underline"
          >
            {account.label}
          </AppLink>
        </div>
        <div className="ml-auto flex items-center lg:hidden">
          <SearchButton compact />
          <MobileMenu items={items} account={account} />
        </div>
      </div>
    </header>
  );
}
