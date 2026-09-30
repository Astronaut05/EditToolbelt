import { cspViolations, expect, PAGES, test } from './fixtures';

test.describe('CSP and headers', () => {
  for (const { name, path } of PAGES) {
    test(`${name} loads with zero CSP violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      expect(await cspViolations(page)).toEqual([]);
    });
  }

  test('search and client-side navigation stay within the CSP', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut');
    await page.goto('/photo', { waitUntil: 'networkidle' });
    await page.keyboard.press('/');
    await page.keyboard.type('trim vid');
    await expect(page.getByRole('option').first()).toContainText('Trim Video');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/trim-video');
    expect(await cspViolations(page)).toEqual([]);
  });

  test('pages carry the security headers and their own CSP', async ({ request }) => {
    const response = await request.get('/photo');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['cross-origin-embedder-policy']).toBeUndefined();
    const html = await response.text();
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-/,
    );
    expect(html).not.toContain("'unsafe-inline' 'sha256");
  });
});

test.describe('cross-origin isolation', () => {
  test('the isolated tool is isolated after arriving from the home search', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('searchbox', { name: 'What do you need to do?' }).fill('video converter');
    await expect(page.getByRole('list', { name: 'Top matches' })).toContainText('Video Converter');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/video-converter');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  });

  test('other pages are not isolated', async ({ page }) => {
    await page.goto('/photo');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  });
});
