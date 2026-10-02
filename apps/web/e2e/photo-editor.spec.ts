import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// P01 Photo Editor (tools/photo.md → Tests): crop + rotate + text +
// brightness, export PNG, compare to a reference worked out here.

/** A 400 × 300 PNG in four flat quadrants, made in the page. */
async function quadrants(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    for (const [x, y, color] of [
      [0, 0, '#c83c3c'],
      [200, 0, '#3cc83c'],
      [0, 150, '#3c3cc8'],
      [200, 150, '#808080'],
    ] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 200, 150);
    }
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** A flat white 400 × 300 PNG. */
async function white(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 300);
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** An image's size, its pixels at some points, and the box around pixels matching a test. */
async function read(page: Page, bytes: Buffer, points: [number, number][], find: 'white' | 'red') {
  return page.evaluate(
    async ([data, at, kind]) => {
      const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      const { data: px, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let [left, top, right, bottom] = [width, height, -1, -1];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const [r = 0, g = 0, b = 0] = [px[i], px[i + 1], px[i + 2]];
          const hit =
            kind === 'white' ? r > 245 && g > 245 && b > 245 : r > 200 && g < 90 && b < 90;
          if (hit) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = Math.max(bottom, y + 1);
          }
        }
      }
      return {
        width,
        height,
        box: right < 0 ? null : { x: left, y: top, width: right - left, height: bottom - top },
        colors: at.map(([x, y]) => {
          const i = (y * width + x) * 4;
          return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
        }),
      };
    },
    [bytes.toString('base64'), points, find] as const,
  );
}

async function open(page: Page, buffer: Buffer) {
  await page.goto('/photo-editor');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('toolbar', { name: 'Modes' })).toBeVisible();
}

const mode = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Modes' }).getByRole('button', { name, exact: true });

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save image', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
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

/** Brightness +50 as the export does it: a midtone curve, v^(2^−0.5). */
const brighter = (v: number) => Math.round(255 * (v / 255) ** (2 ** -0.5));

test('crop, rotate, text and brightness land in the saved PNG as the editor showed them', async ({
  page,
  isMobile,
}) => {
  await open(page, await quadrants(page));
  // Adjust is open first.
  await page.getByRole('slider', { name: 'Brightness' }).fill('50');
  await expect(page.locator('output').filter({ hasText: /^\+50$/ })).toBeVisible();
  await mode(page, 'Rotate 90°').click();
  await mode(page, 'Crop').click();
  // The turned photo is 300 × 400: keep its middle 300 × 200.
  await cropFields(page, isMobile, { 'Crop height': '200', 'Crop top edge, Y': '100' });
  await expect(
    page.getByRole('group', { name: /^Crop box, 300 × 200 px, at 0, 100/ }),
  ).toBeVisible();
  await mode(page, 'Text').click();
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('HELLO');

  const out = await save(page);
  expect(out.name).toBe('photo_edited.png');
  const image = await read(
    page,
    out.bytes,
    [
      [10, 10],
      [290, 10],
      [10, 190],
      [290, 190],
    ],
    'white',
  );
  expect([image.width, image.height]).toEqual([300, 200]);
  // Turned right, the top-left quadrant (red) is now top right, bottom-left (blue) top left,
  // the grey bottom left and the green bottom right; each brightened.
  const [tl, tr, bl, br] = image.colors;
  const near = (got: number[] | undefined, want: number[]) => {
    want.forEach((v, i) => {
      expect(Math.abs((got?.[i] ?? -99) - v)).toBeLessThanOrEqual(1);
    });
  };
  near(tl, [brighter(0x3c), brighter(0x3c), brighter(0xc8)]);
  near(tr, [brighter(0xc8), brighter(0x3c), brighter(0x3c)]);
  near(bl, [brighter(0x80), brighter(0x80), brighter(0x80)]);
  near(br, [brighter(0x3c), brighter(0xc8), brighter(0x3c)]);
  // The text is upright (wider than tall) and in the middle, though the photo was turned.
  const box = image.box;
  expect(box).not.toBeNull();
  expect((box?.width ?? 0) / (box?.height ?? 1)).toBeGreaterThan(2);
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 150)).toBeLessThanOrEqual(6);
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - 100)).toBeLessThanOrEqual(6);
  expect(await cspViolations(page)).toEqual([]);
});

test('a rectangle drawn on a flipped photo lands where it was drawn', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'drawing with a mouse');
  await open(page, await white(page));
  await mode(page, 'Flip').click();
  await mode(page, 'Draw').click();
  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await page.locator('input[type=color][aria-label="Colour"]').fill('#ff0000');
  await page.getByRole('slider', { name: 'Opacity' }).fill('100');
  await page.getByRole('slider', { name: 'Size' }).fill('4');
  const area = await page.getByRole('img', { name: /^Drawing area/ }).boundingBox();
  if (!area) throw new Error('no drawing area');
  const to = (x: number, y: number) => ({
    x: area.x + (x / 400) * area.width,
    y: area.y + (y / 300) * area.height,
  });
  // On screen, from (40, 50) to (160, 120): the left part of what's shown.
  const a = to(40, 50);
  const b = to(160, 120);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  const image = await read(page, (await save(page)).bytes, [], 'red');
  // The saved image is flipped as shown, so the box is where it was drawn on screen.
  expect(Math.abs((image.box?.x ?? 0) - 38)).toBeLessThanOrEqual(3);
  expect(Math.abs((image.box?.y ?? 0) - 48)).toBeLessThanOrEqual(3);
  expect(Math.abs((image.box?.width ?? 0) - 124)).toBeLessThanOrEqual(4);
  expect(Math.abs((image.box?.height ?? 0) - 74)).toBeLessThanOrEqual(4);
});

test('the modes are a rail on the left, or a bar at the bottom on a phone, and the photo stays in view', async ({
  page,
  isMobile,
}) => {
  await open(page, await white(page));
  const rail = page.getByRole('toolbar', { name: 'Modes' });
  // The photo itself, under the layers: its box is the image on screen.
  const photo = page.locator('img[src^="blob:"]:not(.invisible)').first();
  // Every mode is there, and Adjust is open.
  for (const name of [
    'Crop',
    'Straighten',
    'Rotate left',
    'Rotate 90°',
    'Flip',
    'Flip vertical',
    'Adjust',
    'Draw',
    'Text',
    'Blur',
  ]) {
    await expect(mode(page, name)).toBeAttached();
  }
  await expect(mode(page, 'Adjust')).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Adjust', 'Crop', 'Straighten', 'Draw', 'Text', 'Blur']) {
    await mode(page, name).click();
    const [bar, image] = await Promise.all([rail.boundingBox(), photo.boundingBox()]);
    if (!bar || !image) throw new Error(`no rail or photo in ${name}`);
    // The mode's own bar never squeezes the photo out.
    expect(image.height, name).toBeGreaterThan(100);
    if (isMobile) expect(bar.y, name).toBeGreaterThanOrEqual(image.y + image.height - 1);
    else expect(bar.x + bar.width, name).toBeLessThanOrEqual(image.x + 1);
  }
  if (isMobile) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
