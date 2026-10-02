import { categories, categoryPath, toolPath, tools } from '@etb/registry';

import { expect, remote, seriousViolations, test } from './fixtures';

// Rule 9 (WCAG 2.2 AA) on every tool page and hub, as each opens, light and
// dark. a11y.spec.ts covers one page of each kind in every browser and the
// tools' working states; this sweep catches a single tool's own defaults
// (Contrast Checker opened on a pair that failed AA). Chromium on a desktop
// only, and only on the local build: the pages are the same in every browser.
const PATHS = [...categories.map(categoryPath), ...tools.map(toolPath)];

test.skip(
  ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
  'the same pages in every browser',
);
test.skip(remote, 'every page once, on the local build');

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe on every page, ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    for (const path of PATHS) {
      test(path, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle' });
        expect(await seriousViolations(page)).toEqual([]);
      });
    }
  });
}
