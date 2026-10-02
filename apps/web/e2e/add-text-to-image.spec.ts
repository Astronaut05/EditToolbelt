import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// P10 Add Text to Image (tools/photo.md → Tests): multi-line centred text
// renders at the same position as the preview at export resolution.

async function white(page: Page, width: number, height: number) {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box around a saved image's dark pixels. */
async function inkOf(page: Page, png: Buffer): Promise<Box | null> {
  return page.evaluate(async (data) => {
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
        if ((px[(y * width + x) * 4] ?? 255) < 128) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    return right < 0 ? null : { x: left, y: top, width: right - left, height: bottom - top };
  }, png.toString('base64'));
}

/** The box around the preview's text, in image pixels: the text canvas read back and scaled. */
async function previewInk(page: Page, imageWidth: number): Promise<Box | null> {
  return page.evaluate((natural) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label^="Text on the image"]',
    );
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const { data: px, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let [left, top, right, bottom] = [width, height, -1, -1];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((px[(y * width + x) * 4 + 3] ?? 0) > 128) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    const scale = width / natural;
    return right < 0
      ? null
      : {
          x: left / scale,
          y: top / scale,
          width: (right - left) / scale,
          height: (bottom - top) / scale,
        };
  }, imageWidth);
}

async function open(page: Page, width = 800, height = 600) {
  await page.goto('/add-text-to-image');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'card.png',
      mimeType: 'image/png',
      buffer: await white(page, width, height),
    });
  await page.getByRole('button', { name: 'Add text' }).click();
}

/** Black text, no shadow: easy to find in the saved image. */
async function style(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(text);
  await page.locator('input[type=color][aria-label="Colour"]').fill('#000000');
  // Phones fold the styling away under "More".
  const shadow = page.getByRole('switch', { name: 'Shadow' });
  if (!(await shadow.isVisible())) await page.getByText(/^More: alignment/).click();
  await shadow.click();
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

test('multi-line centred text is saved where the preview showed it', async ({ page }) => {
  await open(page);
  await style(page, 'Hello\nWorld');
  // Wait for the font: the preview is drawn again once it's in.
  await expect
    .poll(async () => (await previewInk(page, 800))?.width ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(100);
  await page.evaluate(() => document.fonts.ready);
  const preview = await previewInk(page, 800);
  const out = await save(page);
  expect(out.name).toBe('card_text.png');
  const saved = await inkOf(page, out.bytes);
  expect(preview).not.toBeNull();
  expect(saved).not.toBeNull();
  // Centred on the image: both sides of the block within a few pixels of each other.
  const centreX = (saved?.x ?? 0) + (saved?.width ?? 0) / 2;
  const centreY = (saved?.y ?? 0) + (saved?.height ?? 0) / 2;
  expect(Math.abs(centreX - 400)).toBeLessThanOrEqual(3);
  expect(Math.abs(centreY - 300)).toBeLessThanOrEqual(12);
  // The same place as the preview, within the preview's own pixel size.
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs((preview?.[key] ?? 0) - (saved?.[key] ?? 0))).toBeLessThanOrEqual(4);
  }
  expect(await cspViolations(page)).toEqual([]);
});

test('Uzbek and Cyrillic letters load only the subsets they need', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the same panel on phones');
  const fonts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/fonts/text/')) fonts.push(url.pathname.slice(12));
  });
  await open(page);
  await style(page, 'Oʻzbekiston қ ғ ҳ');
  await page.getByRole('combobox', { name: 'Font' }).selectOption('montserrat');
  await expect
    .poll(() => fonts.filter((f) => f.startsWith('montserrat')).sort())
    .toEqual(['montserrat-cyrillic-ext-700-normal.woff2', 'montserrat-latin-700-normal.woff2']);
  const saved = await inkOf(page, (await save(page)).bytes);
  expect(saved?.width ?? 0).toBeGreaterThan(300);
  expect(await cspViolations(page)).toEqual([]);
});

test('a font file of your own is used, and stays on the page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the same panel on phones');
  const require = createRequire(import.meta.url);
  const oswald = join(
    dirname(require.resolve('@fontsource/oswald/package.json')),
    'files',
    'oswald-latin-400-normal.woff2',
  );
  // Anything sent with a body would be the font going somewhere.
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.postDataBuffer()) uploads.push(request.url());
  });
  await open(page);
  await style(page, 'My own font');
  await page.locator('input[type=file][aria-label="Font file"]').setInputFiles({
    name: 'Headline.woff2',
    mimeType: 'font/woff2',
    buffer: readFileSync(oswald),
  });
  const font = page.getByRole('combobox', { name: 'Font' });
  await expect(font).toHaveValue('user:etb-user-Headline');
  await expect(font.locator('option:checked')).toHaveText('Headline');
  const saved = await inkOf(page, (await save(page)).bytes);
  expect(saved?.width ?? 0).toBeGreaterThan(100);
  expect(uploads).toEqual([]);
});

test('a layer snaps to the middle as it is dragged, and Delete removes it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'dragging with a mouse');
  await open(page);
  const frame = page.getByRole('group', { name: /^Text “Your text”/ });
  await expect(frame).toHaveAccessibleName(/at 400, 300$/);
  const box = await frame.boundingBox();
  if (!box) throw new Error('no frame');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy + 80, { steps: 6 });
  // Back to within a few screen pixels of the middle: it snaps there.
  await page.mouse.move(cx + 3, cy - 4, { steps: 6 });
  await page.mouse.up();
  await expect(frame).toHaveAccessibleName(/at 400, 300$/);
  await frame.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(frame).toHaveAccessibleName(/at 410, 300$/);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('group', { name: /^Text “/ })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Text on the image, 0 layers' })).toBeAttached();
});
