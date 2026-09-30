import { expect, test } from './fixtures';

// T04, T05, T06 (tools/subtitles-and-time.md): live results as you type,
// state in the URL, copy buttons.

test('aspect ratio: ratio of a size, then the missing side', async ({ page }) => {
  await page.goto('/aspect-ratio-calculator');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('16:9');

  await page.getByRole('textbox', { name: 'Width', exact: true }).fill('2560');
  await page.getByRole('textbox', { name: 'Height', exact: true }).fill('1080');
  await expect(results).toContainText('64:27');

  await page.getByRole('radio', { name: 'Missing side' }).click();
  await page.getByRole('textbox', { name: 'Ratio', exact: true }).fill('2.39:1');
  await page.getByRole('textbox', { name: 'Width', exact: true }).fill('1920');
  await expect(results).toContainText('804');
  await expect(results).toContainText('803.35');
});

test('timecode: 1 hour at 29.97 DF is 107,892 frames', async ({ page }) => {
  await page.goto('/timecode-calculator');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('107,892');
  await expect(results).toContainText('1:00:00');

  // Ten minutes skip 2 numbers in 9 of them: 18,000 - 18.
  await page.getByRole('textbox', { name: 'Timecode', exact: true }).fill('00:10:00;00');
  await expect(results).toContainText('17,982');

  // 00:01:00;00 doesn't exist in drop-frame: it's flagged, not guessed.
  await page.getByRole('textbox', { name: 'Timecode', exact: true }).fill('00:01:00;00');
  await expect(results.getByRole('alert')).toBeVisible();
});

test('bitrate: the spec example is 61.44 MB', async ({ page }) => {
  await page.goto('/bitrate-calculator');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('61.44');
  await expect(results).toContainText('58.59');

  await page.getByRole('radio', { name: 'Bitrate' }).click();
  await page.getByRole('textbox', { name: 'Duration', exact: true }).fill('5:00');
  await page.getByRole('textbox', { name: 'File size', exact: true }).fill('100');
  await page.getByRole('textbox', { name: 'Audio bitrate', exact: true }).fill('128');
  await expect(results).toContainText('2,539');
});

test('inputs live in the URL, so a link restores them', async ({ page }) => {
  await page.goto('/aspect-ratio-calculator');
  await page.getByRole('textbox', { name: 'Width', exact: true }).fill('1080');
  await page.getByRole('textbox', { name: 'Height', exact: true }).fill('1920');
  await expect(page).toHaveURL(/width=1080&height=1920/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('1080');
  await expect(page.getByRole('region', { name: 'Results' })).toContainText('9:16');

  // Unknown values fall back to the defaults instead of breaking the page.
  await page.goto('/aspect-ratio-calculator?mode=nope&width=abc');
  await expect(page.getByRole('radio', { name: 'Ratio of a size' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Results' }).getByRole('alert')).toBeVisible();
});

test('copy buttons put the value on the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/bitrate-calculator');
  await page.getByRole('button', { name: 'Copy file size' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('61.44');
});

test('a live tool page has the full template and is indexable', async ({ page }) => {
  await page.goto('/timecode-calculator');
  await expect(page.locator('meta[name=robots]')).toHaveCount(0);
  for (const heading of [
    'How to use the Timecode Calculator',
    'Why use this',
    'Questions',
    'Related tools',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  }
  const types = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) =>
      nodes
        .flatMap((node) => [JSON.parse(node.textContent) as unknown].flat())
        .map((item) => (item as { '@type'?: string })['@type']),
    );
  expect(types).toEqual(expect.arrayContaining(['WebApplication', 'BreadcrumbList', 'FAQPage']));
});
