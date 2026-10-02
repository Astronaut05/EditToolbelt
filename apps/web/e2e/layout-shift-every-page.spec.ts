import { toolPath, tools } from '@etb/registry';

import { expect, remote, test } from './fixtures';

// CLS ≤ 0.05 (docs/10 → Budgets) on every tool page as it opens, on a phone,
// where one column puts the drop zone under everything that loads late. Found
// by Lighthouse: BPM & Key Finder's tap tempo arrived after the first paint
// (0.93); and on CI, without Arial, titles wrapped in a wider fallback font and
// unwrapped when Onest came (up to 0.07). Chromium only (the Layout Instability
// API), local build only.
const PATHS = tools.map(toolPath);

test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || !isMobile, 'phone only');
test.skip(remote, 'every page once, on the local build');

test.describe('layout shift on every tool page', () => {
  for (const path of PATHS) {
    test(path, async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { shifted: number };
        w.shifted = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number }[]) {
            w.shifted += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(path, { waitUntil: 'networkidle' });
      // What loads after the network settles (lazy parts, fonts) has a moment to land.
      await page.waitForTimeout(500);
      const shifted = await page.evaluate(() => (window as unknown as { shifted: number }).shifted);
      expect(shifted).toBeLessThanOrEqual(0.05);
    });
  }
});
