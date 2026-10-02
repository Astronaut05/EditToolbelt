import { readFileSync } from 'node:fs';

import type { Download, Page } from '@playwright/test';
import jsQR from 'jsqr';

import { expect, test } from './fixtures';
import { probe as debugProbe } from './zz-probe';


// DEBUG (claude/debug-webkit-flakes only): stage logs and a page heartbeat.
const probes = new Map<string, Awaited<ReturnType<typeof debugProbe>>>();
test.beforeEach(async ({ page }, testInfo) => {
  probes.set(testInfo.testId, await debugProbe(page, testInfo, 'qr'));
});
test.afterEach(({}, testInfo) => {
  probes.get(testInfo.testId)?.dump();
});

// C03 Color Converter and U01 QR Code Generator (tools/color.md, tools/utility.md).

test('color: any notation in, every notation out', async ({ page }) => {
  await page.goto('/color-converter');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('rgb(255, 99, 71)');
  await expect(results).toContainText('tomato');

  const field = page.getByRole('textbox', { name: 'Color', exact: true });
  await field.fill('rgb(30, 144, 255)');
  await expect(results).toContainText('#1e90ff');
  await expect(results).toContainText('dodgerblue');
  await expect(page).toHaveURL(/c=rgb/);

  await field.fill('oklch(90% 0.4 150)');
  await expect(results).toContainText('clipped');

  await field.fill('not a color');
  await expect(results.getByRole('alert')).toBeVisible();

  await field.fill('#1e90ff');
  await results
    .getByRole('button', { name: /^Use #/ })
    .first()
    .click();
  await expect(field).not.toHaveValue('#1e90ff');
});

/** Reads a downloaded PNG in the page (the browser decodes it) and returns what jsQR finds. */
async function decodeDownload(page: Page, download: Download): Promise<string | null> {
  const path = await download.path();
  const base64 = readFileSync(path).toString('base64');
  const side = 300;
  const pixels = await page.evaluate(
    async ({ data, px }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(image, 0, 0, px, px);
      return Array.from(ctx.getImageData(0, 0, px, px).data);
    },
    { data: base64, px: side },
  );
  return jsQR(Uint8ClampedArray.from(pixels), side, side)?.data ?? null;
}

// A 16 × 16 red PNG, as a stand-in logo.
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4o6FBEmIY1TCqYfhqAAAyBCwQhvh37QAAAABJRU5ErkJggg==',
  'base64',
);

test('QR: a Wi-Fi code downloads as a PNG that decodes to the login', async ({ page }) => {
  await page.goto('/qr-code-generator');
  await page.getByLabel('Content').selectOption('wifi');
  await page.getByRole('textbox', { name: 'Network name' }).fill('Studio; 5G');
  await page.getByRole('textbox', { name: 'Password' }).fill('secret:123');
  await page.getByLabel('PNG size').selectOption('512');
  const expected = 'WIFI:T:WPA;S:Studio\\; 5G;P:secret\\:123;;';
  await expect(page.locator('pre')).toHaveText(expected);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).first().click();
  const png = await download;
  expect(png.suggestedFilename()).toBe('qr-wifi.png');
  expect(await decodeDownload(page, png)).toBe(expected);

  // With a centre logo the level switches to H and the code still reads.
  await page
    .getByLabel('Logo file')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO });
  await expect(page.getByText('H, for the logo')).toBeVisible();
  const withLogo = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).first().click();
  expect(await decodeDownload(page, await withLogo)).toBe(expected);
});

// The page is prerendered, so its fields work before the tool's own script has
// loaded. A choice made then must still count once it has (React 19 drops the
// change event): hold that script back, pick Wi-Fi, then let it load.
test('QR: a choice made before the tool has loaded still counts', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = false;
  await page.route('**/_next/static/**/*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('qr-ssid')) {
      holding = true;
      await held;
    }
    await route.fulfill({ response, body });
  });
  await page.goto('/qr-code-generator', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Content').selectOption('wifi');
  expect(holding).toBe(true);
  release();
  await page.getByRole('textbox', { name: 'Network name' }).fill('Studio');
  await page.getByRole('textbox', { name: 'Password' }).fill('secret');
  await expect(page.locator('pre')).toHaveText('WIFI:T:WPA;S:Studio;P:secret;;');
  await expect(page.getByLabel('Content')).toHaveValue('wifi');
});

test('QR: the SVG is clean and the page warns about colors that may not scan', async ({ page }) => {
  await page.goto('/qr-code-generator');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG' }).click();
  const svg = readFileSync(await (await download).path(), 'utf8');
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).not.toMatch(/<script|\son\w+=/i);

  await page.getByLabel('Dot color').fill('#dddddd');
  await expect(page.getByText(/Contrast is/)).toBeVisible();
});
