import type { Page } from '@playwright/test';

import { expect, pressSearchShortcut, test } from './fixtures';

// The search sheet's code is fetched the first time it's needed
// (packages/ui → SearchOverlay), so there is a moment between asking for
// search and the sheet being there. On a slow connection that moment is long:
// here it is made half a second.

test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'once is enough');
// The service worker would fetch for the page, past the delay below.
test.use({ serviceWorkers: 'block' });

/** Every script asked for from now on arrives late; resolves when the first one has. */
async function slowScripts(page: Page): Promise<() => Promise<unknown>> {
  await page.route(/\.js(\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const arrived = page.waitForResponse((response) => /\.js(\?|$)/.test(response.url()));
  return () => arrived;
}

test('letters typed before the sheet has loaded are in it when it opens', async ({ page }) => {
  await page.goto('/photo', { waitUntil: 'networkidle' });
  await slowScripts(page);
  await pressSearchShortcut(page);
  await page.keyboard.type('trim vid');
  const input = page.getByRole('combobox', { name: 'Search tools' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('trim vid');
  await expect(page.getByRole('option').first()).toContainText('Trim Video');
});

test('Esc before the sheet has loaded takes the ask back', async ({ page }) => {
  await page.goto('/photo', { waitUntil: 'networkidle' });
  const arrived = await slowScripts(page);
  await pressSearchShortcut(page);
  await page.keyboard.type('gif');
  await page.keyboard.press('Escape');
  await arrived();
  // The sheet's code is in, and it stays shut.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const input = page.getByRole('combobox', { name: 'Search tools' });
  await expect(input).toBeHidden();
  // Asked again it opens at once, without the letters of the ask that was taken back.
  await pressSearchShortcut(page);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
});
