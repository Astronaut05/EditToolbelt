import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, expect, pick, test } from './fixtures';

// P14 Split Image into Grid (tools/photo.md → Tests): 3×3 of 3000 × 3000 is
// 9 × 1000 × 1000 in row-major order.

/** A PNG where red rises left to right and green top to bottom, so a tile shows where it came from. */
async function gradient(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
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
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [width, height] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** The entries of a stored (uncompressed) ZIP, in order: enough for the tiles' ZIP. */
function unzipStored(zip: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8);
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    expect(method).toBe(0);
    const start = at + 30 + nameLength + extraLength;
    entries.push({
      name: zip.toString('utf8', at + 30, at + 30 + nameLength),
      data: zip.subarray(start, start + size),
    });
    at = start + size;
  }
  return entries;
}

/** A tile's size and its top-left pixel. */
async function look(page: Page, png: Buffer) {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
    };
  }, png.toString('base64'));
}

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

/** Adds the image, sets the options (phones show them once a file is in), splits and unzips. */
async function split(page: Page, buffer: Buffer, configure?: () => Promise<void>) {
  await fileInput(page).setInputFiles({ name: 'view.png', mimeType: 'image/png', buffer });
  await configure?.();
  await page.getByRole('button', { name: 'Split image', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download ZIP/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('view_grid.zip');
  return unzipStored(readFileSync(await file.path()));
}

test('3 × 3 of 3000 × 3000 is nine 1000 × 1000 tiles, row by row', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/split-image');
  const tiles = await split(page, await gradient(page, 3000, 3000));
  expect(tiles.map((t) => t.name)).toEqual([
    'view_1_r1c1.png',
    'view_2_r1c2.png',
    'view_3_r1c3.png',
    'view_4_r2c1.png',
    'view_5_r2c2.png',
    'view_6_r2c3.png',
    'view_7_r3c1.png',
    'view_8_r3c2.png',
    'view_9_r3c3.png',
  ]);
  const first = await look(page, tiles[0]?.data ?? Buffer.alloc(0));
  const last = await look(page, tiles[8]?.data ?? Buffer.alloc(0));
  expect([first.width, first.height, last.width, last.height]).toEqual([1000, 1000, 1000, 1000]);
  // Top-left of the last tile is (2000, 2000) in the source: red and green at 2/3.
  expect(first.corner.slice(0, 3)).toEqual([0, 0, 128]);
  expect(last.corner.slice(0, 3)).toEqual([170, 170, 128]);
  await expect(page.getByText('9 tiles of 1000 × 1000 px').first()).toBeAttached();
});

test('a carousel in posting order, with feed gaps left out', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await page.goto('/split-image');
  // 3 tiles of 400 px and two gaps of 10 px (2.5 %).
  const tiles = await split(page, await gradient(page, 1220, 400), async () => {
    await pick(page, isMobile, 'Grid', '1x3');
    await choose(page, isMobile, 'Gaps', 'Feed gaps');
    // On phones the gaps, tiles and numbering share one settings row, "Gaps · Tiles · Numbering".
    await choose(page, isMobile, 'Gaps', 'Posting order');
  });
  expect(tiles.map((t) => t.name)).toEqual([
    'view_1_r1c3.png',
    'view_2_r1c2.png',
    'view_3_r1c1.png',
  ]);
  const middle = await look(page, tiles[1]?.data ?? Buffer.alloc(0));
  expect([middle.width, middle.height]).toEqual([400, 400]);
  // The middle tile starts after the first tile and its gap: x = 410.
  expect(middle.corner[0]).toBe(Math.round((410 / 1220) * 255));
});
