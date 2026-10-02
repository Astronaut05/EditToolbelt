import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// P16 Collage Maker (tools/photo.md): four photos in a 2 × 2 grid land on
// exact pixels, with the spacing between and around them; a photo of another
// shape is cropped to fill its box, and rounded corners show the background.

/** A PNG made by the page's canvas: one colour, or a centre colour with `edge` on the outer quarters. */
async function image(page: Page, width: number, height: number, fill: string, edge?: string) {
  const base64 = await page.evaluate(
    async ([w, h, colour, side]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, w, h);
      if (side) {
        ctx.fillStyle = side;
        ctx.fillRect(0, 0, w / 4, h);
        ctx.fillRect((w * 3) / 4, 0, w / 4, h);
      }
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [width, height, fill, edge ?? ''] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** The image's size and a reader for its pixels, decoded by the page. */
async function decode(page: Page, bytes: Buffer, points: [number, number][]) {
  return page.evaluate(
    async ([base64, at]) => {
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return {
        width: bitmap.width,
        height: bitmap.height,
        pixels: at.map(([x, y]) => {
          const i = (y * bitmap.width + x) * 4;
          return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
        }),
      };
    },
    [bytes.toString('base64'), points] as const,
  );
}

async function add(page: Page, files: { name: string; buffer: Buffer }[]) {
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(files.map((f) => ({ ...f, mimeType: 'image/png' })));
  await expect(
    page.getByRole('list', { name: 'Files, in order' }).getByRole('listitem'),
  ).toHaveCount(files.length);
}

/** Spacing, corner radius and background: in place on desktop, in the settings sheet on phones. */
async function look(page: Page, isMobile: boolean, spacing: string, radius: string, bg: string) {
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Spacing/ }).click();
  const scope = isMobile ? sheet : page;
  await scope.getByRole('slider', { name: 'Spacing' }).fill(spacing);
  await scope.getByRole('slider', { name: 'Corner radius' }).fill(radius);
  await scope.locator('input[type=color][aria-label="Background"]').fill(bg);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
}

async function make(page: Page) {
  await page.getByRole('button', { name: 'Make collage', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

const near = (a: number[] | undefined, b: number[], tolerance: number) =>
  b.every((v, i) => Math.abs((a?.[i] ?? -999) - v) <= tolerance);

test('four photos in a 2 × 2 grid land on exact pixels', async ({ page, isMobile }) => {
  await page.goto('/collage-maker');
  const red = await image(page, 300, 300, '#ff0000');
  const green = await image(page, 640, 480, '#00ff00');
  const blue = await image(page, 200, 500, '#0000ff');
  // Wide: cropped to its middle half in a square box, so its yellow sides go.
  const wide = await image(page, 400, 200, '#ff00ff', '#ffff00');
  await add(page, [
    { name: 'red.png', buffer: red },
    { name: 'green.png', buffer: green },
    { name: 'blue.png', buffer: blue },
    { name: 'wide.png', buffer: wide },
  ]);
  await choose(page, isMobile, 'Format', 'PNG');
  await look(page, isMobile, '40', '0', '#000000');
  const out = await make(page);
  expect(out.name).toBe('red_collage.png');
  // 2160 px square, 40 px spacing: boxes of (2160 − 3 × 40) / 2 = 1020 px, at 40 and 1100.
  const points: [number, number][] = [
    [40, 40],
    [1059, 1059],
    [39, 40],
    [40, 39],
    [1060, 500],
    [1099, 500],
    [1100, 500],
    [2119, 40],
    [2120, 40],
    [40, 1100],
    [500, 1099],
    [1059, 2119],
    [1059, 2120],
    [1103, 1610],
    [2116, 1610],
    [1610, 1103],
  ];
  const { width, height, pixels } = await decode(page, out.bytes, points);
  expect([width, height]).toEqual([2160, 2160]);
  const [R, G, B, M, K] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 0, 0],
  ];
  const want = [R, R, K, K, K, K, G, G, K, B, K, B, K, M, M, M];
  pixels.forEach((pixel, i) => {
    expect(near(pixel, want[i] ?? [], 2), `pixel at ${String(points[i])}`).toBe(true);
  });
  expect(await cspViolations(page)).toEqual([]);
});

test('Big left with rounded corners: the first photo large, the corners show the background', async ({
  page,
  isMobile,
}) => {
  await page.goto('/collage-maker');
  const files = await Promise.all(
    ['#2266cc', '#cc6622', '#22aa44'].map(async (colour, i) => ({
      name: `photo-${String(i + 1)}.png`,
      buffer: await image(page, 400, 400, colour),
    })),
  );
  await add(page, files);
  // The last photo goes first, so it's the big one.
  await page.getByRole('button', { name: 'Move photo-3.png up' }).click();
  await page.getByRole('button', { name: 'Move photo-3.png up' }).click();
  // Layout and size share a row on phones.
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Layout/ }).click();
  const scope = isMobile ? sheet : page;
  await scope.getByRole('combobox', { name: 'Layout' }).selectOption('feature');
  await scope.getByRole('combobox', { name: 'Output size' }).selectOption('portrait');
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  await look(page, isMobile, '0', '100', '#ffffff');
  const out = await make(page);
  expect(out.name).toBe('photo-3_collage.jpg');
  // 2160 × 2700, no spacing: the big photo is 1440 px wide, the other two 720 × 1350 beside it.
  const { width, height, pixels } = await decode(page, out.bytes, [
    [2, 2],
    [720, 1350],
    [1437, 2697],
    [1800, 675],
    [1800, 2025],
  ]);
  expect([width, height]).toEqual([2160, 2700]);
  const [corner, big, bigCorner, second, third] = pixels;
  expect(near(corner, [255, 255, 255], 6)).toBe(true);
  expect(near(big, [0x22, 0xaa, 0x44], 6)).toBe(true);
  expect(near(bigCorner, [255, 255, 255], 6)).toBe(true);
  expect(near(second, [0x22, 0x66, 0xcc], 6)).toBe(true);
  expect(near(third, [0xcc, 0x66, 0x22], 6)).toBe(true);
});
