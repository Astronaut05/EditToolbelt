import { readFileSync } from 'node:fs';

import type { Download, Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// P07 Remove Background (tools/photo.md → Tests). CI browsers have no WebGPU
// with 16-bit floats, so these run Light mode: the pipeline end to end, not
// the quality model's accuracy (that is the benchmark's job, docs/14 #11).

const W = 640;
const H = 480;

/** A product shot: a dark red disc on a pale, slightly graded studio backdrop. */
async function productShot(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const backdrop = ctx.createLinearGradient(0, 0, 0, h);
      backdrop.addColorStop(0, '#f4f1ec');
      backdrop.addColorStop(1, '#d9d4cc');
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, w, h);
      const disc = ctx.createRadialGradient(w / 2 - 40, h / 2 - 40, 10, w / 2, h / 2, 150);
      disc.addColorStop(0, '#c0392b');
      disc.addColorStop(1, '#6e1a12');
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 140, 0, Math.PI * 2);
      ctx.fill();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [W, H] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** A downloaded image's size, type and the RGBA of the given pixels. */
async function inspect(page: Page, download: Download, points: [number, number][]) {
  const base64 = readFileSync(await download.path()).toString('base64');
  return page.evaluate(
    async ([data, at]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      const magic = Array.from(bytes.slice(0, 4));
      return {
        width: bitmap.width,
        height: bitmap.height,
        png: magic[0] === 0x89 && magic[1] === 0x50,
        webp: String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
        pixels: at.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)),
      };
    },
    [base64, points] as const,
  );
}

const CENTRE: [number, number] = [W / 2, H / 2];
const CORNER: [number, number] = [8, 8];

async function drop(page: Page) {
  await page.goto('/remove-background');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'disc.jpg', mimeType: 'image/jpeg', buffer: await productShot(page) });
}

const downloadButton = (page: Page, format = 'PNG') =>
  page.getByRole('button', { name: new RegExp(`^Download ${format}`) }).first();

async function save(page: Page, format = 'PNG') {
  const button = downloadButton(page, format);
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  return saved;
}

test('cuts out the subject into a transparent PNG at full size', async ({ page }) => {
  await drop(page);
  const out = await inspect(page, await save(page), [CENTRE, CORNER]);
  expect(out.png).toBe(true);
  expect([out.width, out.height]).toEqual([W, H]);
  // The disc stays, opaque and still red; the backdrop goes.
  const [centre, corner] = out.pixels;
  expect(centre?.[3]).toBeGreaterThan(230);
  expect(centre?.[0]).toBeGreaterThan(centre?.[2] ?? 255);
  expect(corner?.[3]).toBeLessThan(25);
  await expect(page.getByText('WASM', { exact: true }).first()).toBeAttached();
  expect(await cspViolations(page)).toEqual([]);
});

test('a new background reuses the cut-out: color, then WebP', async ({ page, isMobile }) => {
  await drop(page);
  await expect(downloadButton(page)).toBeEnabled({ timeout: 60_000 });
  await choose(page, isMobile, 'Background', 'Color');
  const colour = await inspect(page, await save(page), [CENTRE, CORNER]);
  // White by default: an opaque backdrop, the disc unchanged.
  expect(colour.pixels[1]?.slice(0, 3).every((v) => v > 240)).toBe(true);
  expect(colour.pixels[1]?.[3]).toBe(255);
  expect(colour.pixels[0]?.[0]).toBeGreaterThan(90);
  // On phones Edges and Format share one settings row.
  await choose(page, isMobile, isMobile ? 'Edges' : 'Format', 'WebP');
  const webp = await inspect(page, await save(page, 'WEBP'), [CORNER]);
  expect(webp.webp).toBe(true);
  expect([webp.width, webp.height]).toEqual([W, H]);
});

test('Refine by hand erases what the brush covers', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Painting is covered on desktop; the phone runs the same component');
  await drop(page);
  await expect(downloadButton(page)).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Refine by hand' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Refine brush' });
  await toolbar.getByRole('radio', { name: 'Erase' }).click();
  const box = await page.locator('canvas[aria-label^="Refine brush"]').boundingBox();
  if (!box) throw new Error('no brush canvas');
  // One stroke across the middle of the disc.
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText('1 stroke')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Apply' }).click();
  const out = await inspect(page, await save(page), [CENTRE, [W / 2, H / 2 + 110]]);
  expect(out.pixels[0]?.[3]).toBeLessThan(10); // erased
  expect(out.pixels[1]?.[3]).toBeGreaterThan(230); // the disc below the stroke is kept
});

test('the page says what runs where, and the model is served from MODELS_BASE_URL', async ({
  page,
  request,
}) => {
  await page.goto('/remove-background');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remove Background from Image');
  await expect(page.getByText(/Light · 4\.6 MB/).first()).toBeAttached();
  const model = await request.get('/models/rmbg/u2netp.onnx');
  expect(model.status()).toBe(200);
  const runtime = await request.get('/models/ort/1.30.0/ort.wasm.min.mjs');
  expect(runtime.status()).toBe(200);
});

test('the result goes on to the next tool without a re-upload', async ({ page }) => {
  await drop(page);
  await expect(downloadButton(page)).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Resize Image' }).first().click();
  await expect(page).toHaveURL(/\/resize-image$/);
  await expect(page.getByRole('region', { name: 'Workspace' }).getByText('Original')).toBeVisible();
  // It runs like a dropped file, transparency and all.
  await page.getByRole('button', { name: 'Resize', exact: true }).click();
  const out = await inspect(page, await save(page), [CORNER]);
  expect(out.png).toBe(true);
  expect(out.pixels[0]?.[3]).toBeLessThan(25);
});
