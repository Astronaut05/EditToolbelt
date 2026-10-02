import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// P09 Draw on Image (tools/photo.md → Tests): strokes render as drawn, at
// full size; an arrow's head scales with its stroke width.

/** A flat white PNG, made in the page. */
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

/** Where an image's red pixels are, and its colour at some points. */
async function red(page: Page, png: Buffer, at: [number, number][] = []) {
  return page.evaluate(
    async ([data, points]) => {
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
          if ((px[i] ?? 0) > 200 && (px[i + 1] ?? 0) < 90 && (px[i + 2] ?? 0) < 90) {
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
        colors: points.map(([x, y]) => {
          const i = (y * width + x) * 4;
          return [px[i], px[i + 1], px[i + 2]];
        }),
      };
    },
    [png.toString('base64'), at] as const,
  );
}

/** Opens a 400 × 300 white image in the editor, red at full opacity. */
async function open(page: Page) {
  await page.goto('/draw-on-image');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: await white(page, 400, 300),
    });
  const area = page.getByRole('img', { name: /^Drawing area/ });
  await expect(area).toBeVisible();
  await page.locator('input[type=color][aria-label="Colour"]').fill('#ff0000');
  await page.getByRole('slider', { name: 'Opacity' }).fill('100');
  return area;
}

/** Screen position of an image pixel. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByRole('img', { name: /^Drawing area/ }).boundingBox();
  if (!box) throw new Error('no drawing area');
  return { x: box.x + (x / 400) * box.width, y: box.y + (y / 300) * box.height };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await screen(page, ...from);
  const b = await screen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
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

test('a rectangle lands where it was drawn, at full size', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drawing with a mouse; the phone layout is covered below');
  await open(page);
  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await page.getByRole('slider', { name: 'Size' }).fill('4');
  await drag(page, [100, 100], [300, 200]);
  const out = await save(page);
  expect(out.name).toBe('shot_annotated.png');
  const found = await red(page, out.bytes, [
    [100, 150],
    [300, 150],
    [200, 100],
    [200, 150],
  ]);
  expect([found.width, found.height]).toEqual([400, 300]);
  // A 4 px stroke centred on the box's edges: within a pixel of 98-302 by 98-202.
  expect(Math.abs((found.box?.x ?? 0) - 98)).toBeLessThanOrEqual(2);
  expect(Math.abs((found.box?.y ?? 0) - 98)).toBeLessThanOrEqual(2);
  expect(Math.abs((found.box?.width ?? 0) - 204)).toBeLessThanOrEqual(3);
  expect(Math.abs((found.box?.height ?? 0) - 104)).toBeLessThanOrEqual(3);
  const [left, right, top, middle] = found.colors;
  expect(left?.[0]).toBeGreaterThan(200);
  expect(left?.[1]).toBeLessThan(90);
  expect(right?.[1]).toBeLessThan(90);
  expect(top?.[1]).toBeLessThan(90);
  // Inside stays white.
  expect(middle).toEqual([255, 255, 255]);
  expect(await cspViolations(page)).toEqual([]);
});

test('an arrow’s head grows with its stroke width', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drawing with a mouse');
  const head = async (size: string) => {
    await open(page);
    await page.getByRole('radio', { name: 'Arrow' }).click();
    await page.getByRole('slider', { name: 'Size' }).fill(size);
    await drag(page, [60, 150], [340, 150]);
    return (await red(page, (await save(page)).bytes)).box;
  };
  const thin = await head('4');
  const thick = await head('12');
  // The head's base is wider than the stroke, and 3 × the width makes it 3 × as wide.
  const ratio = (thick?.height ?? 0) / (thin?.height ?? 1);
  expect(ratio).toBeGreaterThan(2.6);
  expect(ratio).toBeLessThan(3.4);
  // Both end at the tip.
  expect(Math.abs((thin?.x ?? 0) + (thin?.width ?? 0) - 340)).toBeLessThanOrEqual(2);
  expect(Math.abs((thick?.x ?? 0) + (thick?.width ?? 0) - 340)).toBeLessThanOrEqual(2);
});

test('shapes take two clicks, markers count up, and undo takes the last off', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: 'Line' }).click();
  // Two clicks, no drag: from the first to the second.
  const a = await screen(page, 50, 50);
  const b = await screen(page, 350, 50);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.getByRole('radio', { name: 'Numbered marker' }).click();
  for (const [x, y] of [
    [100, 200],
    [300, 200],
  ] as const) {
    const at = await screen(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  await page.getByRole('button', { name: 'Undo' }).click();
  const out = await save(page);
  // Beside each marker's number, inside its circle.
  const found = await red(page, out.bytes, [
    [200, 50],
    [107, 200],
    [307, 200],
  ]);
  const [line, first, second] = found.colors;
  expect(line?.[1]).toBeLessThan(90);
  // The first marker is red around its number; the second was undone.
  expect(first?.[0]).toBeGreaterThan(200);
  expect(second).toEqual([255, 255, 255]);
});

/** axe's serious and critical issues on the page as it is (WCAG 2.2 AA). */
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => violation.id);
}

test('marks are added, moved, resized and removed from the keyboard', async ({ page }) => {
  await open(page);
  // The tools are a radio group: the arrow keys pick one.
  await page.getByRole('radio', { name: 'Arrow' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Rectangle' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Rectangle' })).toBeFocused();
  await page.getByRole('slider', { name: 'Size' }).fill('4');
  // "Add rectangle": a quarter of the image across, in its middle, focused to move.
  await page.getByRole('button', { name: 'Add rectangle' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('group', { name: /^Rectangle 1, 100 × 75 px at 150, 113$/ }),
  ).toBeFocused();
  // 20 px right and 10 down, then 10 px wider from its far corner.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Alt+Shift+ArrowRight');
  const box = page.getByRole('group', { name: /^Rectangle 1, 110 × 75 px at 170, 123$/ });
  await expect(box).toBeFocused();
  await expect(box).toHaveAccessibleDescription(/Arrow keys move it/);

  // A marker, then Delete: the drawing is back to one mark, and focus goes back to it.
  await page.getByRole('radio', { name: 'Rectangle' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Numbered marker' })).toBeChecked();
  await page.getByRole('button', { name: 'Add marker' }).focus();
  await page.keyboard.press('Enter');
  const marker = page.getByRole('group', { name: /^Numbered marker 2, number 1 at 200, 150$/ });
  await expect(marker).toBeFocused();
  // The marks and their focus boxes pass axe, light and dark.
  expect(await seriousViolations(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('img', { name: 'Drawing area, 1 mark' })).toBeVisible();
  await expect(box).toBeFocused();

  // The saved file has the rectangle where the keys put it: 170-280 by 123-198, a 4 px stroke.
  const out = await save(page);
  const found = await red(page, out.bytes, [[225, 160]]);
  expect(Math.abs((found.box?.x ?? 0) - 168)).toBeLessThanOrEqual(2);
  expect(Math.abs((found.box?.y ?? 0) - 121)).toBeLessThanOrEqual(2);
  expect(Math.abs((found.box?.width ?? 0) - 114)).toBeLessThanOrEqual(3);
  expect(Math.abs((found.box?.height ?? 0) - 79)).toBeLessThanOrEqual(3);
  expect(found.colors[0]).toEqual([255, 255, 255]);
});
