import { test as base, expect, type Page } from '@playwright/test';

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
  { name: 'calculator', path: '/aspect-ratio-calculator' },
  { name: 'color converter', path: '/color-converter' },
  { name: 'qr generator', path: '/qr-code-generator' },
  { name: 'file tool', path: '/subtitle-converter' },
  { name: 'image tool', path: '/image-converter' },
  { name: 'pair page', path: '/convert/srt-to-vtt' },
  { name: 'isolated tool', path: '/video-converter' },
  { name: 'legal', path: '/privacy' },
  { name: 'licenses', path: '/licenses' },
  { name: 'not found', path: '/no-such-page' },
] as const;

/** Picks a setting: a segmented control on desktop, a row that opens a sheet on phones. */
export async function choose(page: Page, isMobile: boolean, label: string, value: string) {
  if (isMobile) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await sheet.getByRole('radio', { name: value, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  } else {
    await page.getByRole('radio', { name: value, exact: true }).click();
  }
}
