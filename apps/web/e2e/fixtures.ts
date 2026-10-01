import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every page records CSP violations from the first byte on. When a test
 * fails, the page's errors and any alert on screen go to the log, so a CI
 * failure in a browser we can't run locally still says what went wrong.
 */
export const test = base.extend({
  page: async ({ page }, provide, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await provide(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      const alerts = await page
        .getByRole('alert')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const report = [...errors, ...alerts.map((text) => `alert: ${text}`)];
      if (report.length > 0) {
        console.log(`[${testInfo.project.name}] ${testInfo.title}\n  ${report.join('\n  ')}`);
      }
    }
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
  { name: 'coming soon', path: '/upscale-image' },
  { name: 'calculator', path: '/aspect-ratio-calculator' },
  { name: 'color converter', path: '/color-converter' },
  { name: 'qr generator', path: '/qr-code-generator' },
  { name: 'file tool', path: '/subtitle-converter' },
  { name: 'image tool', path: '/image-converter' },
  { name: 'editor tool', path: '/crop-image' },
  { name: 'pair page', path: '/convert/srt-to-vtt' },
  { name: 'video tool', path: '/video-converter' },
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

/** Picks from a dropdown setting: in place on desktop, in the settings sheet on phones. */
export async function pick(page: Page, isMobile: boolean, label: string, value: string) {
  if (isMobile) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await sheet.getByRole('combobox', { name: label }).selectOption(value);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  } else {
    await page.getByRole('combobox', { name: label }).selectOption(value);
  }
}

/** A time as the timeline's In and Out fields show it: "00:00:05.000". */
function shownTime(seconds: string): string {
  const total = Number(seconds);
  const m = Math.floor(total / 60);
  return `00:${String(m).padStart(2, '0')}:${(total % 60).toFixed(3).padStart(6, '0')}`;
}

/**
 * Types Out, then In, into the timeline and waits until both show them. Two
 * commits in a row can land before the page has re-rendered the first (seen
 * once in WebKit: In applied to the old Out), so the pair is typed again
 * until the selection holds both.
 */
export async function setRange(page: Page, start: string, end: string): Promise<void> {
  const inPoint = page.getByRole('textbox', { name: 'In point' });
  const outPoint = page.getByRole('textbox', { name: 'Out point' });
  await expect(async () => {
    await outPoint.fill(end);
    await outPoint.press('Enter');
    await inPoint.fill(start);
    await inPoint.press('Enter');
    await expect(inPoint).toHaveValue(shownTime(start), { timeout: 1000 });
    await expect(outPoint).toHaveValue(shownTime(end), { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}
