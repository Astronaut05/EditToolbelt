import { cspViolations, expect, PAGES, pressSearchShortcut, remote, test } from './fixtures';

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
    await pressSearchShortcut(page);
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
    if (remote) {
      // The server build (src/lib/csp.ts): prerendered pages allow inline
      // scripts; pages rendered per request get a nonce and are never cached.
      expect(headers['content-security-policy']).toMatch(
        /^default-src 'self'; script-src 'self' 'unsafe-inline'/,
      );
      const signIn = (await request.get('/sign-in')).headers();
      expect(signIn['content-security-policy']).toMatch(
        /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
      );
      expect(signIn['cache-control']).toBe('private, no-store');
      return;
    }
    const html = await response.text();
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-/,
    );
    expect(html).not.toContain("'unsafe-inline' 'sha256");
  });
});

test.describe('cross-origin isolation', () => {
  // No route needs it today (V03 runs on WebCodecs); the headers and the
  // full-page-load links come back with the registry's crossOriginIsolated flag.
  test('no page is isolated, the video converter included', async ({ page }) => {
    for (const path of ['/', '/photo', '/video-converter']) {
      await page.goto(path);
      expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    }
  });
});
