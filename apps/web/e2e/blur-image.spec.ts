import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// P12 Blur & Pixelate (tools/photo.md → Tests): a fixture with 4 faces gives
// 4 detections; pixelate's block size is exact.

const FACE = fileURLToPath(new URL('../../../fixtures/photo/face.jpg', import.meta.url));

/** The four copies of face.jpg in the collage: left, top and size, px. */
const COPIES = [
  [20, 20, 256],
  [600, 10, 320],
  [60, 480, 200],
  [520, 390, 360],
] as const;

/** A 1024 × 768 grey PNG with the face at four sizes, made in the page. */
async function collage(page: Page): Promise<Buffer> {
  const face = readFileSync(FACE).toString('base64');
  const base64 = await page.evaluate(
    async ([data, copies]) => {
      const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
      const canvas = new OffscreenCanvas(1024, 768);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 1024, 768);
      for (const [x, y, size] of copies) ctx.drawImage(bitmap, x, y, size, size);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [face, COPIES] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** A 256 × 192 PNG of fixed noise, made in the page. */
async function noise(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(256, 192);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const image = ctx.createImageData(256, 192);
    let s = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        image.data[i + c] = s & 255;
      }
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** An image's RGBA pixels, decoded in the page. */
async function pixels(page: Page, bytes: Buffer) {
  const { width, height, data } = await page.evaluate(async (b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw]), { premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, data: Array.from(image.data) };
  }, bytes.toString('base64'));
  const at = (x: number, y: number) => data.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
  return { width, height, at };
}

async function open(page: Page, name: string, buffer: Buffer) {
  await page.goto('/blur-image');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name, mimeType: 'image/png', buffer });
  await expect(page.getByRole('img', { name: /^Photo with/ })).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save image', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('Find faces finds the four faces; one turned off stays as it was', async ({ page }) => {
  // The first run downloads and compiles ONNX Runtime's 14 MB WASM: slow under a full parallel run.
  test.setTimeout(120_000);
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.postDataBuffer()) sent.push(request.url());
  });
  await open(page, 'four.png', await collage(page));
  await page.getByRole('button', { name: 'Find faces' }).click();
  await expect(page.getByRole('status').filter({ hasText: /faces found/ })).toHaveText(
    /^4 faces found and hidden/,
    { timeout: 60_000 },
  );
  const faces = page.getByRole('button', { name: /^Hide face \d$/ });
  await expect(faces).toHaveCount(4);
  for (const face of await faces.all()) await expect(face).toHaveAttribute('aria-pressed', 'true');
  // Left to right: the 256 px copy, the 200 px one (turned off here), the 360 px one, the 320 px one.
  await page.getByRole('button', { name: 'Hide face 2' }).click();
  await expect(page.getByRole('button', { name: 'Hide face 2' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('radio', { name: 'Solid' }).click();
  await page.locator('input[type=color][aria-label="Colour"]').fill('#ff00ff');
  const out = await save(page);
  expect(out.name).toBe('four_blurred.png');
  const image = await pixels(page, out.bytes);
  expect([image.width, image.height]).toEqual([1024, 768]);
  // The middle of each copy's face: 44 % across and 24 % down face.jpg.
  const middle = ([x, y, size]: readonly [number, number, number]) =>
    image.at(Math.round(x + size * 0.44), Math.round(y + size * 0.24));
  const [first, second, third, fourth] = COPIES;
  for (const copy of [first, second, fourth]) expect(middle(copy)).toEqual([255, 0, 255, 255]);
  // Face 2, the 200 px copy, was turned off: its skin is still there.
  const kept = middle(third);
  expect(kept[0]).toBeGreaterThan(150);
  expect(kept[1]).toBeGreaterThan(100);
  expect(kept[1]).toBeLessThan(kept[0] ?? 0);
  // The grey around them is untouched.
  expect(image.at(500, 700)).toEqual([128, 128, 128, 255]);
  expect(sent).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test('pixelate blocks are exactly the size set, from the box’s corner', async ({ page }) => {
  const input = await noise(page);
  const before = await pixels(page, input);
  await open(page, 'noise.png', input);
  await page.getByRole('radio', { name: 'Pixelate' }).click();
  await page.getByRole('slider', { name: 'Block' }).fill('16');
  await expect(page.locator('output').filter({ hasText: /^16 px$/ })).toBeVisible();
  // A box from the keyboard: a quarter of the image, in its middle (96, 72, 64 × 48),
  // then 10 px to the right.
  await page.getByRole('button', { name: 'Add box' }).click();
  const box = page.getByRole('group', { name: /^Box 1, 64 × 48 px at 96, 72/ });
  await box.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('group', { name: /^Box 1, 64 × 48 px at 106, 72/ })).toBeVisible();
  const out = await save(page);
  const image = await pixels(page, out.bytes);
  for (let by = 72; by < 120; by += 16) {
    for (let bx = 106; bx < 170; bx += 16) {
      const block = image.at(bx, by);
      for (let y = by; y < by + 16; y += 1) {
        for (let x = bx; x < bx + 16; x += 1) expect(image.at(x, y)).toEqual(block);
      }
    }
  }
  // The block edges are where they should be, and nothing outside the box changed.
  expect(image.at(122, 72)).not.toEqual(image.at(121, 72));
  for (const [x, y] of [
    [105, 80],
    [170, 80],
    [120, 71],
    [120, 120],
    [0, 0],
  ] as const) {
    expect(image.at(x, y)).toEqual(before.at(x, y));
  }
});

test('a dragged box blurs inside it only, and undo takes it off', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drawing with a mouse; Add box covers the phone');
  const input = await noise(page);
  const before = await pixels(page, input);
  await open(page, 'noise.png', input);
  const area = page.getByRole('img', { name: /^Photo with/ });
  const rect = await area.boundingBox();
  if (!rect) throw new Error('no photo');
  const to = (x: number, y: number) => ({
    x: rect.x + (x / 256) * rect.width,
    y: rect.y + (y / 192) * rect.height,
  });
  const drag = async (from: [number, number], end: [number, number]) => {
    const a = to(...from);
    const b = to(...end);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  };
  await drag([40, 40], [120, 120]);
  await drag([150, 40], [230, 120]);
  await expect(area).toHaveAccessibleName('Photo with 2 hidden areas');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(area).toHaveAccessibleName('Photo with 1 hidden area');
  const image = await pixels(page, (await save(page)).bytes);
  const spread = (img: typeof image, x0: number, y: number) => {
    const values: number[] = [];
    for (let x = x0; x < x0 + 20; x += 1) values.push(img.at(x, y)[0] ?? 0);
    return Math.max(...values) - Math.min(...values);
  };
  // Noise spans most of 0-255; blurred, it's close to flat.
  expect(spread(image, 70, 80)).toBeLessThan(spread(before, 70, 80) / 4);
  // Outside, and where the undone box was, the noise is as it was.
  expect(image.at(20, 20)).toEqual(before.at(20, 20));
  expect(image.at(190, 80)).toEqual(before.at(190, 80));
});

test('the blur bar fits a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await open(page, 'noise.png', await noise(page));
  await expect(page.getByRole('button', { name: 'Find faces' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
