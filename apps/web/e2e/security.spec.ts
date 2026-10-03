import type { Page } from '@playwright/test';

import {
  choose,
  cspViolations,
  expect,
  PAGES,
  pressSearchShortcut,
  remote,
  test,
} from './fixtures';

/** One second of a 440 Hz tone as a 16-bit mono WAV: decodes in every browser. */
function toneWav(): Buffer {
  const rate = 48_000;
  const out = Buffer.alloc(44 + rate * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + rate * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i += 1) {
    out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), 44 + i * 2);
  }
  return out;
}

/** Converts the tone to MP3: LAME compiles its WebAssembly in a blob worker, under the page's CSP. */
async function convertToMp3(page: Page, isMobile: boolean) {
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await choose(page, isMobile, 'Format', 'MP3');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Download MP3/ }).first()).toBeEnabled({
    timeout: 30_000,
  });
  expect(await cspViolations(page)).toEqual([]);
}

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

  // A client-side navigation keeps the CSP of the page it started on, so a hub
  // must allow what a tool opened from it compiles
  // (docs/decisions/2026-10-02-server-build-csp.md).
  test('a tool opened by a client-side navigation can still compile WebAssembly', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/audio', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    await page
      .getByRole('link', { name: /^Audio Converter/ })
      .first()
      .click();
    await page.waitForURL('**/audio-converter');
    expect(
      await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument),
    ).toBe(true);
    await convertToMp3(page, isMobile);
  });

  test('a pair page compiles its tool’s WebAssembly', async ({ page, isMobile }) => {
    await page.goto('/convert/wav-to-mp3');
    await convertToMp3(page, isMobile);
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
        /^default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';/,
      );
      const signIn = (await request.get('/sign-in')).headers();
      expect(signIn['content-security-policy']).toMatch(
        /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'sha256-[A-Za-z0-9+/=]+';/,
      );
      expect(signIn['cache-control']).toBe('private, no-store');
      return;
    }
    const html = await response.text();
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-/,
    );
    expect(html).not.toContain("'unsafe-inline' 'sha256");
  });
});

test.describe('cross-origin isolation', () => {
  // No route needs it today (V03 runs on WebCodecs); the headers and the
  // full-page-load links come back with the registry's crossOriginIsolated flag.
  test('no page is isolated, the video converter included', async ({ page }) => {
    for (const path of ['/', '/photo', '/video-converter']) {
      // Settled first: WebKit fails the next navigation with "internal error"
      // now and then while the router's prefetches are still in flight.
      await page.goto(path, { waitUntil: 'networkidle' });
      expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    }
  });
});
