import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, expect, test, unzipStored } from './fixtures';

// P13 Social Media Image Resizer (tools/photo.md → Tests): 6 presets from one
// image come out at their exact sizes, and the focal point is respected.

type Paint =
  { kind: 'gradient' } | { kind: 'spot'; x: number; y: number; side: number } | { kind: 'noise' };

/** A test image made in the page: a gradient, blue with a red square, or noise. */
async function image(page: Page, width: number, height: number, paint: Paint): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ w, h, p }) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const data = ctx.createImageData(w, h);
      let seed = 1;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          let rgb: [number, number, number];
          if (p.kind === 'gradient')
            rgb = [Math.round((x / w) * 255), Math.round((y / h) * 255), 128];
          else if (p.kind === 'noise') {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            rgb = [seed & 255, (seed >> 8) & 255, (seed >> 16) & 255];
          } else {
            const inside = x >= p.x && x < p.x + p.side && y >= p.y && y < p.y + p.side;
            rgb = inside ? [255, 0, 0] : [0, 0, 255];
          }
          data.data.set([...rgb, 255], i);
        }
      }
      ctx.putImageData(data, 0, 0);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { w: width, h: height, p: paint },
  );
  return Buffer.from(base64, 'base64');
}

/** An image's size and the pixels at some points. */
async function look(page: Page, file: Buffer, points: [number, number][] = []) {
  return page.evaluate(
    async ({ data, at }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        pixels: at.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))),
      };
    },
    { data: file.toString('base64'), at: points },
  );
}

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

/** Ticks or unticks sizes, by platform and name: in place on desktop, in the settings sheet on phones. */
async function sizes(page: Page, isMobile: boolean, changes: [string, RegExp, boolean][]) {
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Sizes/ }).click();
  const scope = isMobile ? sheet : page;
  for (const [platform, name, on] of changes) {
    await scope
      .getByRole('group', { name: platform })
      .getByRole('checkbox', { name })
      .setChecked(on);
  }
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
}

/** Resizes and saves the download: its name and bytes. */
async function resize(page: Page) {
  await page.getByRole('button', { name: 'Resize image', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 90_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('six sizes from one image, each at its exact size, in one ZIP', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  await page.goto('/social-media-image-resizer');
  await fileInput(page).setInputFiles({
    name: 'view.png',
    mimeType: 'image/png',
    buffer: await image(page, 2400, 1600, { kind: 'gradient' }),
  });
  // Instagram 4:5 is picked already.
  await sizes(page, isMobile, [
    ['Instagram', /^Story, Reel cover/, true],
    ['YouTube', /^Thumbnail/, true],
    ['X', /^Header/, true],
    ['LinkedIn', /^Profile banner/, true],
    ['Pinterest', /^Pin/, true],
  ]);
  await expect(page.getByText('6 images in a ZIP, each at its exact size').first()).toBeAttached();
  const { name, bytes } = await resize(page);
  expect(name).toBe('view_social.zip');
  const files = unzipStored(bytes);
  expect(files.map((file) => file.name)).toEqual([
    'view-instagram-portrait-1080x1350.png',
    'view-instagram-story-1080x1920.png',
    'view-youtube-thumbnail-1280x720.png',
    'view-x-header-1500x500.png',
    'view-linkedin-banner-1584x396.png',
    'view-pinterest-pin-1000x1500.png',
  ]);
  const made = [];
  for (const file of files) made.push(await look(page, file.data));
  expect(made.map((m) => `${String(m.width)}x${String(m.height)}`)).toEqual([
    '1080x1350',
    '1080x1920',
    '1280x720',
    '1500x500',
    '1584x396',
    '1000x1500',
  ]);
});

test('the focal point keeps the subject in frame', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await page.goto('/social-media-image-resizer');
  // A red square near the left edge of a wide picture: a centred square crop cuts it away.
  await fileInput(page).setInputFiles({
    name: 'spot.png',
    mimeType: 'image/png',
    buffer: await image(page, 1600, 900, { kind: 'spot', x: 100, y: 350, side: 200 }),
  });
  await sizes(page, isMobile, [
    ['Instagram', /^Post, square/, true],
    ['Instagram', /^Post, portrait/, false],
  ]);

  // Centred: no red where the square would land.
  let out = await resize(page);
  expect(out.name).toBe('spot_instagram-square-1080x1080.png');
  let seen = await look(page, out.bytes, [[240, 540]]);
  expect([seen.width, seen.height]).toEqual([1080, 1080]);
  expect(seen.pixels[0]).toEqual([0, 0, 255]);

  // Back to the settings, click the square: the crop moves to the left edge, and the square is in it.
  await page.getByRole('button', { name: 'Back to the settings' }).click();
  const picker = page.getByRole('application', { name: /^Focal point/ });
  const img = picker.locator('img');
  const box = await img.boundingBox();
  if (!box) throw new Error('no image');
  await img.click({ position: { x: box.width * (200 / 1600), y: box.height * 0.5 } });
  // Within a pixel of the click: 12-14% across, 49-51% down.
  await expect(page.getByText(/^Focal point 1[234]% across, (49|50|51)% down/)).toBeVisible();
  out = await resize(page);
  seen = await look(page, out.bytes, [[240, 540]]);
  expect(seen.pixels[0]).toEqual([255, 0, 0]);
});

test('the arrow keys move the focal point, and Home centres it', async ({ page }) => {
  await page.goto('/social-media-image-resizer');
  await fileInput(page).setInputFiles({
    name: 'view.png',
    mimeType: 'image/png',
    buffer: await image(page, 400, 300, { kind: 'gradient' }),
  });
  const picker = page.getByRole('application', { name: /^Focal point/ });
  await picker.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByText(/^Focal point 48% across, 40% down/)).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByText(/^Focal point 50% across, 50% down/)).toBeVisible();
});

test('fit on a color keeps the whole image', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await page.goto('/social-media-image-resizer');
  await fileInput(page).setInputFiles({
    name: 'spot.png',
    mimeType: 'image/png',
    buffer: await image(page, 1000, 1000, { kind: 'spot', x: 0, y: 0, side: 100 }),
  });
  await sizes(page, isMobile, [
    ['X', /^Header/, true],
    ['Instagram', /^Post, portrait/, false],
  ]);
  await choose(page, isMobile, 'Fit', 'Fit on color');
  const out = await resize(page);
  expect(out.name).toBe('spot_x-header-1500x500.png');
  // 1000 × 1000 fits as 500 × 500 in the middle; white bands either side.
  const seen = await look(page, out.bytes, [
    [100, 250],
    [1400, 250],
    [520, 20],
    [900, 250],
  ]);
  expect([seen.width, seen.height]).toEqual([1500, 500]);
  expect(seen.pixels).toEqual([
    [255, 255, 255],
    [255, 255, 255],
    [255, 0, 0],
    [0, 0, 255],
  ]);
});

test('a YouTube thumbnail stays under 2 MB', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await page.goto('/social-media-image-resizer');
  await fileInput(page).setInputFiles({
    name: 'noise.png',
    mimeType: 'image/png',
    buffer: await image(page, 1280, 720, { kind: 'noise' }),
  });
  await sizes(page, isMobile, [
    ['YouTube', /^Thumbnail/, true],
    ['Instagram', /^Post, portrait/, false],
  ]);
  // JPG at quality 100: noise this size is about 2.7 MB, over YouTube's limit.
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Format/ }).click();
  const scope = isMobile ? sheet : page;
  await scope.getByRole('radio', { name: 'JPG', exact: true }).click();
  await scope.getByRole('slider', { name: 'Quality' }).fill('100');
  if (isMobile) await page.keyboard.press('Escape');
  const out = await resize(page);
  expect(out.name).toBe('noise_youtube-thumbnail-1280x720.jpg');
  expect(out.bytes.length).toBeLessThanOrEqual(2_000_000);
  await expect(
    page.getByText(/YouTube · Thumbnail: quality \d+ to stay under the 2 MB limit/).first(),
  ).toBeAttached();
});
