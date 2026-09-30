import { readFileSync } from 'node:fs';

import { jpegWithExif, readJpegExif } from '@etb/engines';
import type { Download, Page } from '@playwright/test';

import { choose, expect, test } from './fixtures';

// P05 Compress Image and P06 Image Converter (tools/photo.md).

/** Draws a test image in the page and returns its bytes. */
async function drawImage(
  page: Page,
  kind: 'transparent-png' | 'noisy-jpeg' | 'small-jpeg',
): Promise<Buffer> {
  const base64 = await page.evaluate(async (which) => {
    const size =
      which === 'noisy-jpeg' ? [1600, 1200] : which === 'small-jpeg' ? [320, 240] : [640, 480];
    const [width = 1, height = 1] = size;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    if (which === 'transparent-png') {
      // Left half transparent, right half red.
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(width / 2, 0, width / 2, height);
    } else {
      const image = ctx.createImageData(width, height);
      let seed = 7;
      for (let i = 0; i < image.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        image.data[i] = (i / 4) % 256;
        image.data[i + 1] = seed % 256;
        image.data[i + 2] = 128;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }
    const blob = await canvas.convertToBlob({
      type: which === 'transparent-png' ? 'image/png' : 'image/jpeg',
      quality: 0.95,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, kind);
  return Buffer.from(base64, 'base64');
}

/** Decodes a downloaded image in the page: its size and the RGBA of two pixels. */
async function inspect(page: Page, download: Download) {
  const base64 = readFileSync(await download.path()).toString('base64');
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      width: bitmap.width,
      height: bitmap.height,
      left: pixel(10, 10),
      right: pixel(bitmap.width - 10, bitmap.height / 2),
    };
  }, base64);
}

/** A little-endian EXIF block with Make "Canon", Orientation 1 and a GPS position. */
function exifWithGps(): Uint8Array {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const text = (value: string) => Array.from(value, (c) => c.charCodeAt(0));
  return Uint8Array.from([
    ...text('II'),
    ...u16(42),
    ...u32(8),
    ...u16(3),
    ...u16(0x010f),
    ...u16(2),
    ...u32(6),
    ...u32(50),
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(1),
    0,
    0,
    ...u16(0x8825),
    ...u16(4),
    ...u32(1),
    ...u32(56),
    ...u32(0),
    ...text('Canon'),
    0,
    ...u16(1),
    ...u16(0x0002),
    ...u16(5),
    ...u32(3),
    ...u32(74),
    ...u32(0),
    ...u32(41),
    ...u32(1),
    ...u32(17),
    ...u32(1),
    ...u32(3),
    ...u32(1),
  ]);
}

async function run(page: Page, button: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = page.getByRole('button', { name: /^Download (JPG|PNG|WEBP|AVIF|BMP)/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  return saved;
}

test('a transparent PNG becomes a JPG on white, same size in pixels', async ({
  page,
  isMobile,
}) => {
  await page.goto('/image-converter');
  const png = await drawImage(page, 'transparent-png');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await choose(page, isMobile, 'Convert to', 'JPG');
  const file = await run(page, 'Convert');
  expect(file.suggestedFilename()).toBe('logo.jpg');
  const out = await inspect(page, file);
  expect([out.width, out.height]).toEqual([640, 480]);
  expect(out.left.slice(0, 3).every((channel) => channel > 245)).toBe(true);
  expect(out.right[0]).toBeGreaterThan(230);
  expect(out.right[1]).toBeLessThan(25);
  await expect(
    page.getByText(/Transparent areas filled with #FFFFFF/).filter({ visible: true }),
  ).toBeVisible();
});

test('camera details stay, the GPS location goes', async ({ page }) => {
  await page.goto('/image-converter');
  const jpeg = jpegWithExif(new Uint8Array(await drawImage(page, 'small-jpeg')), exifWithGps());
  if (!jpeg) throw new Error('EXIF too big');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'holiday.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) });
  const file = await run(page, 'Convert');
  await expect(
    page.getByText('GPS location removed, camera details kept').filter({ visible: true }),
  ).toBeVisible();
  const exif = readJpegExif(new Uint8Array(readFileSync(await file.path())));
  expect(exif).not.toBeNull();
  const tiff = Buffer.from(exif ?? []);
  expect(tiff.includes(Buffer.from('Canon'))).toBe(true);
  expect(tiff.includes(Buffer.from([0x25, 0x88]))).toBe(false); // no GPS pointer
  expect(tiff.includes(Buffer.from([41, 0, 0, 0, 1, 0, 0, 0, 17, 0, 0, 0]))).toBe(false);
});

test('compress to a target size lands under it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the number field is tested on desktop; the sheet is covered elsewhere');
  await page.goto('/compress-image');
  const jpeg = await drawImage(page, 'noisy-jpeg');
  expect(jpeg.length).toBeGreaterThan(400_000);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'noisy.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('radio', { name: 'Target size', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Target size' }).fill('250');
  const file = await run(page, 'Compress');
  expect(file.suggestedFilename()).toBe('noisy_compressed.jpg');
  const size = readFileSync(await file.path()).length;
  expect(size).toBeLessThanOrEqual(250_000);
  expect(size).toBeGreaterThan(150_000);
});

test('compressing an already optimized PNG gives the original back', async ({ page }) => {
  await page.goto('/compress-image');
  const png = await drawImage(page, 'transparent-png');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: png });
  const first = readFileSync(await (await run(page, 'Compress')).path());
  expect(first.length).toBeLessThan(png.length);

  await page.getByRole('button', { name: 'Start over' }).first().click();
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: first });
  const second = readFileSync(await (await run(page, 'Compress')).path());
  expect(second.equals(first)).toBe(true);
  await expect(
    page
      .getByText('Already as small as this format gets: this is your original file')
      .filter({ visible: true }),
  ).toBeVisible();
});

test('files it cannot take are refused with a reason', async ({ page }) => {
  await page.goto('/image-converter');
  // A PNG header claiming 20000 × 20000 px (400 MP).
  const huge = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 6, 0, 0, 0]),
  ]);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: huge });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByText(/the browser limit is 100 MP/)).toBeVisible();
});

test('the PNG to JPG pair page is preset to JPG', async ({ page, isMobile }) => {
  await page.goto('/convert/png-to-jpg');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PNG to JPG Converter');
  await expect(page.getByRole('heading', { name: 'About PNG and JPG' })).toBeVisible();
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'a.png',
      mimeType: 'image/png',
      buffer: await drawImage(page, 'transparent-png'),
    });
  if (isMobile) await expect(page.getByRole('button', { name: /^Convert to.*JPG/ })).toBeVisible();
  else await expect(page.getByRole('radio', { name: 'JPG', exact: true })).toBeChecked();
});
