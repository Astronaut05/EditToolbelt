import { readFileSync } from 'node:fs';

import type { Download, Page } from '@playwright/test';

import { choose, cspViolations, expect, test, unzip } from './fixtures';

// P11 Watermark Images (tools/photo.md → Tests): 20 mixed-size images get a
// logo bottom right at 15% of their width, in the same relative place.

/** A flat PNG of a colour, made in the page. */
async function flat(page: Page, width: number, height: number, color = '#808080') {
  const base64 = await page.evaluate(
    async ([w, h, fill]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [width, height, color] as const,
  );
  return Buffer.from(base64, 'base64');
}

/**
 * Where an image's pixels of a kind are: the box around them, how many, and
 * the darkest red-free level among them, read by the page.
 */
async function found(page: Page, bytes: Buffer, kind: 'red' | 'dark') {
  return page.evaluate(
    async ([data, which]) => {
      const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      const { data: px, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let [left, top, right, bottom, count, darkest] = [width, height, -1, -1, 0, 255];
      const quadrants = new Set<number>();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const [r, g, b] = [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
          darkest = Math.min(darkest, g);
          const hit = which === 'red' ? r > 200 && g < 60 && b < 60 : g < 128;
          if (!hit) continue;
          count += 1;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
          quadrants.add((x < width / 2 ? 0 : 1) + (y < height / 2 ? 0 : 2));
        }
      }
      return {
        width,
        height,
        box: { x: left, y: top, width: right - left, height: bottom - top },
        count,
        darkest,
        quadrants: quadrants.size,
      };
    },
    [bytes.toString('base64'), kind] as const,
  );
}

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

const bytesOf = async (download: Download) => readFileSync(await download.path());

/** Opens a settings group on phones; the settings themselves on desktop. */
async function settings(page: Page, isMobile: boolean, row: RegExp) {
  if (!isMobile) return page.getByRole('region', { name: 'Settings' });
  await page.getByRole('button', { name: row }).click();
  return page.getByRole('dialog', { name: 'Settings' });
}

async function closeSheet(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
}

/** The red 100 × 50 logo, a PNG. */
const logo = (page: Page) => flat(page, 100, 50, '#ff0000');

test('20 mixed sizes get the logo bottom right at 15% width, in the same relative place', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'batch download is covered on desktop');
  test.setTimeout(180_000);
  await page.goto('/watermark-image');
  const sizes = [
    [400, 300],
    [300, 400],
    [1000, 500],
    [640, 640],
    [900, 1600],
    [1200, 800],
    [800, 1200],
    [720, 1280],
    [1024, 768],
    [500, 1000],
    [333, 777],
    [1500, 500],
    [256, 256],
    [1280, 720],
    [600, 900],
    [1600, 1200],
    [480, 640],
    [1600, 900],
    [350, 350],
    [1100, 700],
  ] as const;
  const files = [];
  for (const [i, [w, h]] of sizes.entries()) {
    files.push({
      name: `img-${String(i)}.png`,
      mimeType: 'image/png',
      buffer: await flat(page, w, h),
    });
  }
  await fileInput(page).setInputFiles(files);
  const start = page.getByRole('button', { name: 'Add watermark · 20 files' });
  await expect(page.getByText('Type the watermark text.').first()).toBeVisible();
  await expect(start).toBeDisabled();
  await choose(page, false, 'Watermark', 'Logo');
  await expect(page.getByText('Choose a logo image.').first()).toBeVisible();
  const panel = page.getByRole('region', { name: 'Settings' });
  await panel
    .locator('input[type=file][aria-label="Logo"]')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await logo(page) });
  await expect(panel.getByRole('radio', { name: 'Bottom right' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await panel.getByRole('slider', { name: 'Opacity' }).fill('100');
  await start.click();
  const all = page.getByRole('button', { name: 'Download all · ZIP' });
  await expect(all).toBeEnabled({ timeout: 120_000 });
  // All 20 are checked from the ZIP. Chromium starts at most 10 downloads a
  // second from one page and drops the rest without an event, and 20 file
  // buttons clicked one after another on a fast machine pass that (the 11th
  // never came on CI). Two file buttons give the same bytes as the ZIP.
  const saved = page.waitForEvent('download');
  await all.click();
  const zip = await saved;
  expect(zip.suggestedFilename()).toBe('watermark-image.zip');
  const entries = unzip(await bytesOf(zip));
  expect(entries.map((entry) => entry.name)).toEqual(
    sizes.map((_, i) => `img-${String(i)}_watermarked.png`),
  );
  const output = (i: number) => entries[i]?.data ?? Buffer.alloc(0);
  for (const i of [0, sizes.length - 1]) {
    const one = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download img-${String(i)}.png` }).click();
    const file = await one;
    expect(file.suggestedFilename()).toBe(`img-${String(i)}_watermarked.png`);
    expect((await bytesOf(file)).equals(output(i))).toBe(true);
  }
  for (const [i, [w, h]] of sizes.entries()) {
    const out = await found(page, output(i), 'red');
    // 15% of the width, the logo's 2:1 shape, 2% of the width from the right and bottom.
    const width = Math.round(w * 0.15);
    const margin = Math.round(w * 0.02);
    expect([out.width, out.height]).toEqual([w, h]);
    expect(out.box).toEqual({
      x: w - margin - width,
      y: h - margin - Math.round(width / 2),
      width,
      height: Math.round(width / 2),
    });
  }
  expect(await cspViolations(page)).toEqual([]);
});

test('text goes in its spot, and a new opacity redoes it', async ({ page, isMobile }) => {
  await page.goto('/watermark-image');
  await fileInput(page).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await flat(page, 800, 600, '#ffffff'),
  });
  let scope = await settings(page, isMobile, /^Watermark/);
  await scope.getByRole('textbox', { name: 'Text', exact: true }).fill('© Test');
  await scope.locator('input[type=color][aria-label="Colour"]').fill('#000000');
  await closeSheet(page, isMobile);
  scope = await settings(page, isMobile, /^Position/);
  await scope.getByRole('radio', { name: 'Top left' }).click();
  await closeSheet(page, isMobile);
  scope = await settings(page, isMobile, /^Tile/);
  await scope.getByRole('slider', { name: 'Opacity' }).fill('100');
  await closeSheet(page, isMobile);
  await page.getByRole('button', { name: 'Add watermark', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  let saved = page.waitForEvent('download');
  await download.click();
  const full = await found(page, await bytesOf(await saved), 'dark');
  // All the text inside its box: 120 px wide (15% of 800), 16 px (2%) from the top left.
  expect(full.count).toBeGreaterThan(200);
  expect(full.box.x).toBeGreaterThanOrEqual(16);
  expect(full.box.y).toBeGreaterThanOrEqual(16);
  expect(full.box.x + full.box.width).toBeLessThanOrEqual(16 + 120);
  expect(full.box.y + full.box.height).toBeLessThanOrEqual(16 + 60);
  expect(full.darkest).toBeLessThan(10);
  await expect(
    page.getByText(/^Text 120 × \d+ px at 100%$/).filter({ visible: true }),
  ).toBeVisible();
  // Half opacity, redone as the slider stops: black at 50% over white is mid grey.
  scope = await settings(page, isMobile, /^Tile/);
  await scope.getByRole('slider', { name: 'Opacity' }).fill('50');
  await closeSheet(page, isMobile);
  await expect(
    page.getByText(/^Text 120 × \d+ px at 50%$/).filter({ visible: true }),
  ).toBeVisible();
  saved = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /^Download/ })
    .first()
    .click();
  const half = await found(page, await bytesOf(await saved), 'dark');
  expect(Math.abs(half.darkest - 128)).toBeLessThanOrEqual(2);
  expect(await cspViolations(page)).toEqual([]);
});

test('a tiled logo covers every part of the photo', async ({ page, isMobile }) => {
  await page.goto('/watermark-image');
  await fileInput(page).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await flat(page, 900, 600),
  });
  await choose(page, isMobile, 'Watermark', 'Logo');
  const scope = await settings(page, isMobile, /^Watermark/);
  await scope
    .locator('input[type=file][aria-label="Logo"]')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await logo(page) });
  await closeSheet(page, isMobile);
  await choose(page, isMobile, 'Tile', 'Tiled');
  await expect(page.getByRole('radiogroup', { name: 'Position' })).toBeHidden();
  await page.getByRole('button', { name: 'Add watermark', exact: true }).click();
  await expect(
    page.getByText(/^Logo tiled \d+ times at 60%$/).filter({ visible: true }),
  ).toBeVisible({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /^Download/ })
    .first()
    .click();
  const out = await found(page, await bytesOf(await saved), 'dark');
  // At 60%, red over grey: green drops to about 51; marks in all four quarters.
  expect(out.quadrants).toBe(4);
  expect(Math.abs(out.darkest - Math.round(128 * 0.4))).toBeLessThanOrEqual(2);
});

test('a logo that is not an image says so', async ({ page, isMobile }) => {
  await page.goto('/watermark-image');
  await fileInput(page).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await flat(page, 400, 300),
  });
  await choose(page, isMobile, 'Watermark', 'Logo');
  const scope = await settings(page, isMobile, /^Watermark/);
  await scope
    .locator('input[type=file][aria-label="Logo"]')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
  await closeSheet(page, isMobile);
  await page.getByRole('button', { name: 'Add watermark', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The logo must be a PNG, WebP or JPG' }),
  ).toBeVisible();
});

test('the position grid moves with the arrow keys', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard on desktop');
  await page.goto('/watermark-image');
  await fileInput(page).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await flat(page, 400, 300),
  });
  const grid = page.getByRole('radiogroup', { name: 'Position' });
  await grid.getByRole('radio', { name: 'Bottom right' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(grid.getByRole('radio', { name: 'Right', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(grid.getByRole('radio', { name: 'Centre' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(grid.getByRole('radio', { name: 'Top left' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(grid.getByRole('radio', { checked: true })).toHaveCount(1);
});
