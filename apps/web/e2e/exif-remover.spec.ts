import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { expect, pick, test } from './fixtures';

// P15 Photo Metadata Viewer & Remover (tools/photo.md → Tests): after removal
// no GPS tags remain, and a JPEG's pixel data is unchanged byte for byte.

const ascii = (s: string) => Array.from(Buffer.from(s, 'latin1'));
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** Little-endian EXIF: Make "Canon", Orientation 1, and GPS 41°18'38.92" N, 69°14'26.02" E. */
function exif(): number[] {
  const out: number[] = [...ascii('II'), ...u16(42), ...u32(8)];
  // IFD0 at 8: Make (6 bytes at 50), Orientation 1, GPS pointer (56).
  out.push(...u16(3));
  out.push(...u16(0x010f), ...u16(2), ...u32(6), ...u32(50));
  out.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(1), 0, 0);
  out.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(56));
  out.push(...u32(0), ...ascii('Canon\0'));
  // GPS IFD at 56: 4 entries; latitude at 110, longitude at 134.
  out.push(...u16(4));
  out.push(...u16(1), ...u16(2), ...u32(2), ...ascii('N\0'), 0, 0);
  out.push(...u16(2), ...u16(5), ...u32(3), ...u32(110));
  out.push(...u16(3), ...u16(2), ...u32(2), ...ascii('E\0'), 0, 0);
  out.push(...u16(4), ...u16(5), ...u32(3), ...u32(134));
  out.push(...u32(0));
  out.push(...u32(41), ...u32(1), ...u32(18), ...u32(1), ...u32(3892), ...u32(100));
  out.push(...u32(69), ...u32(1), ...u32(14), ...u32(1), ...u32(2602), ...u32(100));
  return out;
}

/** A real JPEG from the page's canvas with the EXIF above added after SOI. */
async function photo(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#3a7';
    ctx.fillRect(0, 0, 64, 48);
    ctx.fillStyle = '#d33';
    ctx.fillRect(10, 10, 20, 20);
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer(),
    );
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  const jpeg = Buffer.from(base64, 'base64');
  const body = [...ascii('Exif\0\0'), ...exif()];
  const app1 = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** From the first SOS to the end: the picture data. */
const scan = (jpeg: Buffer) => {
  const at = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xda);
  return jpeg.subarray(at);
};

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

test('shows the camera and place at once, and removes them without touching the pixels', async ({
  page,
}) => {
  await page.goto('/exif-remover');
  const source = await photo(page);
  await fileInput(page).setInputFiles({
    name: 'IMG_0042.jpg',
    mimeType: 'image/jpeg',
    buffer: source,
  });

  const report = page.getByRole('region', { name: 'Workspace' }).getByLabel('Full report');
  await expect(report).toContainText('Make              Canon');
  await expect(report).toContainText(/Coordinates\s+41\.310811, 69\.240561\s+\(removed\)/);
  await expect(page.getByText('GPS location removed').first()).toBeAttached();
  await expect(
    page.getByText('Pixels untouched: only the metadata changed').first(),
  ).toBeAttached();

  const button = page.getByRole('button', { name: /^Download JPG/ }).first();
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('IMG_0042_clean.jpg');
  const clean = readFileSync(await file.path());
  expect(clean.includes(Buffer.from('Canon'))).toBe(false);
  expect(clean.includes(Buffer.from([0x25, 0x88]))).toBe(false); // the GPS pointer tag
  expect(clean.includes(Buffer.from('Exif'))).toBe(false); // upright: no EXIF left at all
  expect(scan(clean).equals(scan(source))).toBe(true);
});

test('location only keeps the camera; just looking changes nothing', async ({ page, isMobile }) => {
  await page.goto('/exif-remover');
  const source = await photo(page);
  await fileInput(page).setInputFiles({ name: 'trip.jpg', mimeType: 'image/jpeg', buffer: source });
  const report = page.getByRole('region', { name: 'Workspace' }).getByLabel('Full report');
  await expect(report).toContainText('Canon');

  await pick(page, isMobile, 'Remove', 'location');
  await expect(report).toContainText(/Coordinates\s+41\.310811, 69\.240561\s+\(removed\)/);
  await expect(report).not.toContainText(/Make\s+Canon\s+\(removed\)/);
  let download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /^Download JPG/ })
    .first()
    .click();
  const located = readFileSync(await (await download).path());
  expect(located.includes(Buffer.from('Canon'))).toBe(true);
  expect(located.includes(Buffer.from([0x25, 0x88]))).toBe(false);

  await pick(page, isMobile, 'Remove', 'none');
  await expect(
    page.getByText('Nothing removed: this is your original file').first(),
  ).toBeAttached();
  download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /^Download JPG/ })
    .first()
    .click();
  expect(readFileSync(await (await download).path()).equals(source)).toBe(true);
});
