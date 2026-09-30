import { readFileSync } from 'node:fs';

import type { Download, Page } from '@playwright/test';

import { choose, expect, pick, test } from './fixtures';

// P02 Crop Image and P03 Resize Image (tools/photo.md → Tests).

/**
 * Draws a test image in the page: red rises left to right and green top to
 * bottom, so every pixel tells where it came from. Optionally the left half
 * is transparent.
 */
async function makeImage(
  page: Page,
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/png',
  transparentLeft = false,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h, mime, clear]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const image = ctx.createImageData(w, h);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          image.data[i] = Math.round((x / w) * 255);
          image.data[i + 1] = Math.round((y / h) * 255);
          image.data[i + 2] = 128;
          image.data[i + 3] = clear && x < w / 2 ? 0 : 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob({ type: mime, quality: 0.95 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [width, height, type, transparentLeft] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** A downloaded image's size in px and the RGBA of the given pixels. */
async function inspect(page: Page, download: Download, points: [number, number][] = []) {
  const base64 = readFileSync(await download.path()).toString('base64');
  return page.evaluate(
    async ([data, at]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        pixels: at.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)),
      };
    },
    [base64, points] as const,
  );
}

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

async function add(page: Page, name: string, buffer: Buffer, mimeType = 'image/jpeg') {
  await fileInput(page).setInputFiles({ name, mimeType, buffer });
}

/** Runs the tool and saves the result. */
async function run(page: Page, button: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = page.getByRole('button', { name: /^Download (JPG|PNG|WEBP|AVIF)/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  return saved;
}

/** The crop box fields: in the settings on desktop, in their own sheet on phones. */
async function cropFields(page: Page, isMobile: boolean, fill: Record<string, string>) {
  const scope = page.getByRole(isMobile ? 'dialog' : 'region', {
    name: isMobile ? 'Crop box' : 'Settings',
  });
  if (isMobile) await page.getByRole('button', { name: /^Crop box/ }).click();
  for (const [label, value] of Object.entries(fill)) {
    await scope.getByRole('spinbutton', { name: label }).fill(value);
  }
  await scope.getByRole('spinbutton', { name: 'Crop width' }).press('Tab');
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(scope).toBeHidden();
  }
}

const close = (value: number | undefined, expected: number, within = 6) =>
  Math.abs((value ?? -1000) - expected) <= within;

test('crops 4000 × 3000 to 1:1, centered, as 3000 × 3000', async ({ page, isMobile }) => {
  await page.goto('/crop-image');
  await add(page, 'wide.jpg', await makeImage(page, 4000, 3000, 'image/jpeg'));
  await expect(page.getByRole('group', { name: /^Crop box, 4000 × 3000 px/ })).toBeVisible();
  await pick(page, isMobile, 'Ratio', '1:1');
  await expect(
    page.getByRole('group', { name: /^Crop box, 3000 × 3000 px, at 500, 0/ }),
  ).toBeVisible();
  const file = await run(page, 'Crop image');
  expect(file.suggestedFilename()).toBe('wide_cropped.jpg');
  const out = await inspect(page, file, [[0, 1500]]);
  expect([out.width, out.height]).toEqual([3000, 3000]);
  // The left edge is the source's x = 500: red 500 / 4000 × 255 ≈ 32.
  expect(close(out.pixels[0]?.[0], 32)).toBe(true);
});

test('crops an exact 1080 × 1350 from a box moved anywhere', async ({ page, isMobile }) => {
  await page.goto('/crop-image');
  await add(page, 'photo.jpg', await makeImage(page, 2000, 1600, 'image/jpeg'));
  await cropFields(page, isMobile, { 'Crop width': '1080', 'Crop height': '1350' });
  const box = page.getByRole('group', { name: /^Crop box, 1080 × 1350 px/ });
  await expect(box).toBeVisible();
  if (isMobile) {
    await cropFields(page, isMobile, { 'Crop left edge, X': '700', 'Crop top edge, Y': '200' });
  } else {
    // Drag the box, then nudge it with the keyboard.
    const rect = await box.boundingBox();
    if (!rect) throw new Error('no box');
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 400, rect.y + rect.height / 2 + 400, {
      steps: 8,
    });
    await page.mouse.up();
    await box.focus();
    await page.keyboard.press('Shift+ArrowLeft');
  }
  const label = (await box.getAttribute('aria-label')) ?? '';
  const [, x = '0', y = '0'] = /at (\d+), (\d+)/.exec(label) ?? [];
  if (!isMobile) expect(Number(x)).toBeGreaterThan(0);
  const file = await run(page, 'Crop image');
  const out = await inspect(page, file, [[0, 0]]);
  expect([out.width, out.height]).toEqual([1080, 1350]);
  // The first pixel is the source pixel at the box's corner.
  expect(close(out.pixels[0]?.[0], Math.round((Number(x) / 2000) * 255))).toBe(true);
  expect(close(out.pixels[0]?.[1], Math.round((Number(y) / 1600) * 255))).toBe(true);
});

test('crop keeps PNG transparency, and turns with Rotate 90°', async ({ page }) => {
  await page.goto('/crop-image');
  await add(page, 'logo.png', await makeImage(page, 400, 300, 'image/png', true), 'image/png');
  await page.getByRole('button', { name: 'Rotate 90°' }).click();
  await expect(page.getByRole('group', { name: /^Crop box, 300 × 400 px/ })).toBeVisible();
  const file = await run(page, 'Crop image');
  expect(file.suggestedFilename()).toBe('logo_cropped.png');
  // Turned clockwise, the transparent left half is now the top half.
  const out = await inspect(page, file, [
    [150, 20],
    [150, 380],
  ]);
  expect([out.width, out.height]).toEqual([300, 400]);
  expect(out.pixels[0]?.[3]).toBe(0);
  expect(out.pixels[1]?.[3]).toBe(255);
  await page.getByRole('button', { name: 'Back to the editor' }).first().click();
  await expect(page.getByRole('group', { name: /^Crop box, 300 × 400 px/ })).toBeVisible();
});

test('a batch crops to a ratio, centered', async ({ page, isMobile }) => {
  await page.goto('/crop-image');
  const [a, b] = [
    await makeImage(page, 800, 600, 'image/jpeg'),
    await makeImage(page, 600, 900, 'image/jpeg'),
  ];
  await fileInput(page).setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: a },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: b },
  ]);
  const start = page.getByRole('button', { name: 'Crop image · 2 files' });
  await expect(start).toBeDisabled();
  await expect(page.getByText('Pick a ratio to crop several images')).toBeVisible();
  await pick(page, isMobile, 'Ratio', '1:1');
  await start.click();
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download b.jpg' }).click();
  const out = await inspect(page, await saved);
  expect([out.width, out.height]).toEqual([600, 600]);
});

test('resizes to the exact size for each fit', async ({ page, isMobile }) => {
  test.skip(isMobile, 'every fit on desktop; the phone sheet is covered below');
  await page.goto('/resize-image');
  const source = await makeImage(page, 1600, 1200, 'image/jpeg');
  const expected: Record<string, [number, number]> = {
    'Keep ratio': [1440, 1080],
    Pad: [1920, 1080],
    Fill: [1920, 1080],
    Stretch: [1920, 1080],
  };
  for (const [fit, size] of Object.entries(expected)) {
    await add(page, 'photo.jpg', source);
    await choose(page, false, 'Fit', fit);
    const file = await run(page, 'Resize');
    expect(file.suggestedFilename()).toBe('photo_resized.jpg');
    const out = await inspect(page, file, [
      [4, 540],
      [960, 540],
    ]);
    expect([out.width, out.height], fit).toEqual(size);
    if (fit === 'Pad') {
      // White bars left and right; the photo in the middle.
      expect(out.pixels[0]?.slice(0, 3).every((c) => c > 245)).toBe(true);
      expect(close(out.pixels[1]?.[0], 128, 10)).toBe(true);
    }
    await page.getByRole('button', { name: 'Start over' }).first().click();
  }
});

test('a preset from the phone sheet, with padding', async ({ page, isMobile }) => {
  await page.goto('/resize-image');
  await add(page, 'photo.jpg', await makeImage(page, 1200, 1200, 'image/jpeg'));
  await pick(page, isMobile, 'Resize to', 'story-1080x1920');
  await choose(page, isMobile, 'Fit', 'Pad');
  // Phones show Padding in the Fit row's sheet.
  await choose(page, isMobile, isMobile ? 'Fit' : 'Padding', 'Black');
  const file = await run(page, 'Resize');
  const out = await inspect(page, file, [[540, 10]]);
  expect([out.width, out.height]).toEqual([1080, 1920]);
  expect(out.pixels[0]?.slice(0, 3).every((c) => c < 10)).toBe(true);
});

test('a batch of 10 mixed sizes gets a longest side of 2048', async ({ page, isMobile }) => {
  test.skip(isMobile, 'batch download is covered on desktop');
  test.setTimeout(120_000);
  await page.goto('/resize-image');
  const sizes = [
    [400, 300],
    [300, 400],
    [1000, 500],
    [640, 640],
    [900, 1600],
    [2400, 1600],
    [3000, 1000],
    [720, 1280],
    [1024, 768],
    [500, 2500],
  ] as const;
  const files = [];
  for (const [i, [w, h]] of sizes.entries()) {
    files.push({
      name: `img-${String(i)}.jpg`,
      mimeType: 'image/jpeg',
      buffer: await makeImage(page, w, h, 'image/jpeg'),
    });
  }
  await fileInput(page).setInputFiles(files);
  await pick(page, false, 'Resize to', 'longest');
  await page.getByRole('spinbutton', { name: 'Longest side' }).fill('2048');
  await page.getByRole('button', { name: 'Resize · 10 files' }).click();
  await expect(page.getByRole('button', { name: 'Download all · ZIP' })).toBeEnabled({
    timeout: 60_000,
  });
  for (const [i, [w, h]] of sizes.entries()) {
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download img-${String(i)}.jpg` }).click();
    const out = await inspect(page, await saved);
    expect(Math.max(out.width, out.height)).toBe(2048);
    expect(Math.abs(out.width / out.height - w / h)).toBeLessThan(0.01);
  }
});
