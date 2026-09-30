import { test as base, expect } from '@playwright/test';

/** Every page records CSP violations from the first byte on. */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await provide(page);
  },
});

export { expect };

export async function cspViolations(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** One page of each kind (docs/12 → axe on every page type). */
export const PAGES = [
  { name: 'home', path: '/' },
  { name: 'hub', path: '/photo' },
  { name: 'coming soon', path: '/remove-background' },
  { name: 'isolated tool', path: '/video-converter' },
  { name: 'legal', path: '/privacy' },
  { name: 'licenses', path: '/licenses' },
  { name: 'not found', path: '/no-such-page' },
] as const;
