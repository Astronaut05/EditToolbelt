import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// P18 Images to PDF (tools/photo.md): images in the order set, one per page;
// JPEGs byte for byte, a sideways phone photo placed upright, a PNG stored
// losslessly with its transparency, and the page sizes.

/** An image made by the page's canvas: a flat colour with a red square, as JPEG or PNG. */
async function image(page: Page, type: 'image/jpeg' | 'image/png', width: number, height: number) {
  const base64 = await page.evaluate(
    async ([kind, w, h]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      if (kind === 'image/jpeg') {
        ctx.fillStyle = '#3a7';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.fillStyle = '#d33';
      ctx.fillRect(0, 0, w / 4, h / 4);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: kind, quality: 0.9 })).arrayBuffer(),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [type, width, height] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** The JPEG with an EXIF block saying "turn 90° right to stand upright" (orientation 6). */
function turned(jpeg: Buffer): Buffer {
  const tiff = [
    0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** A PDF's page sizes, placement matrices and image streams, read from its text. */
function readPdf(bytes: Buffer) {
  const text = bytes.toString('latin1');
  const pages = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const matrices = [...text.matchAll(/q ([-\d. ]+) cm \/Im0 Do Q/g)].map((m) =>
    (m[1] ?? '').split(' ').map(Number),
  );
  const images = [...text.matchAll(/\/Subtype \/Image ([^]*?)>>\nstream\n/g)].map((m) => {
    const start = m.index + m[0].length;
    const length = Number(/\/Length (\d+)/.exec(m[1] ?? '')?.[1]);
    return { dict: m[1] ?? '', data: bytes.subarray(start, start + length) };
  });
  return { count: Number(/\/Count (\d+)/.exec(text)?.[1]), pages, matrices, images };
}

async function make(page: Page) {
  await page.getByRole('button', { name: 'Make PDF', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('three images become three pages in the order set, JPEGs untouched', async ({ page }) => {
  await page.goto('/images-to-pdf');
  const wide = await image(page, 'image/jpeg', 400, 200);
  const sideways = turned(await image(page, 'image/jpeg', 300, 200));
  const logo = await image(page, 'image/png', 80, 60);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles([
      { name: 'logo.png', mimeType: 'image/png', buffer: logo },
      { name: 'wide.jpg', mimeType: 'image/jpeg', buffer: wide },
      { name: 'sideways.jpg', mimeType: 'image/jpeg', buffer: sideways },
    ]);
  const list = page.getByRole('list', { name: 'Files, in order' });
  await expect(list).toContainText('400 × 200 px · JPEG');
  // The logo goes last.
  await page.getByRole('button', { name: 'Move logo.png down' }).click();
  await page.getByRole('button', { name: 'Move logo.png down' }).click();
  const out = await make(page);
  expect(out.name).toBe('wide.pdf');
  const pdf = readPdf(out.bytes);
  expect(pdf.count).toBe(3);
  // A4 in each image's direction: the wide one landscape, the upright phone photo portrait.
  expect(pdf.pages).toEqual([
    [841.89, 595.28],
    [595.28, 841.89],
    [841.89, 595.28],
  ]);
  // The JPEGs, byte for byte.
  expect(pdf.images[0]?.data.equals(wide)).toBe(true);
  expect(pdf.images[1]?.data.equals(sideways)).toBe(true);
  // The sideways one is turned by its matrix: its rows run down the page.
  const [a = 0, b = 0, c = 0, d = 0] = pdf.matrices[1] ?? [];
  expect(a).toBe(0);
  expect(d).toBe(0);
  expect(b).toBeLessThan(0);
  expect(c).toBeGreaterThan(0);
  // The PNG, lossless: 80 × 60 RGB, red in its corner, and its transparency as a mask.
  const png = pdf.images[2];
  expect(png?.dict).toContain('/Filter /FlateDecode');
  expect(png?.dict).toContain('/SMask');
  const rgb = inflateSync(png?.data ?? Buffer.alloc(0));
  expect(rgb.length).toBe(80 * 60 * 3);
  expect([...rgb.subarray(0, 3)]).toEqual([0xdd, 0x33, 0x33]);
  const mask = inflateSync(pdf.images[3]?.data ?? Buffer.alloc(0));
  expect(mask[0]).toBe(255);
  expect(mask[80 * 60 - 1]).toBe(0);
  expect(await cspViolations(page)).toEqual([]);
});

test('"Fit image" makes each page the image’s own size, plus the margins', async ({
  page,
  isMobile,
}) => {
  await page.goto('/images-to-pdf');
  const photo = await image(page, 'image/jpeg', 800, 600);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.getByRole('list', { name: 'Files, in order' })).toContainText('800 × 600 px');
  await choose(page, isMobile, 'Page size', 'Fit image');
  await choose(page, isMobile, 'Margins', 'None');
  const pdf = readPdf((await make(page)).bytes);
  // 96 px to the inch: 800 × 600 px is 600 × 450 pt.
  expect(pdf.pages).toEqual([[600, 450]]);
  expect(pdf.matrices[0]).toEqual([600, 0, 0, 450, 0, 0]);
});
