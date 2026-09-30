import AxeBuilder from '@axe-core/playwright';

import { expect, PAGES, test } from './fixtures';

async function seriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const { name, path } of PAGES) {
      test(`${name}: no serious issues`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle' });
        expect(await seriousViolations(page)).toEqual([]);
      });
    }

    test('search overlay: no serious issues', async ({ page, isMobile }) => {
      await page.goto('/photo', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByRole('combobox', { name: 'Search tools' }).fill('gif');
      await expect(page.getByRole('option').first()).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      if (isMobile) return;
    });

    test('tool shell demo: no serious issues', async ({ page }) => {
      await page.goto('/workshop/screens/tool-result', { waitUntil: 'networkidle' });
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}
