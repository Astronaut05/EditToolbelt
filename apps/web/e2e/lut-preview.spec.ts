import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// C05 LUT Preview (tools/color.md → Tests): an identity LUT leaves the image
// as it was; a known LUT matches its reference within 1/255.

/** A 64 × 64 PNG where red, green and blue all vary, made in the page. */
async function swatch(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const image = ctx.createImageData(64, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const i = (y * 64 + x) * 4;
        image.data[i] = x * 4;
        image.data[i + 1] = y * 4;
        image.data[i + 2] = (x + y) * 2;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** An image's RGBA pixels, decoded by the page. */
async function pixels(page: Page, png: Buffer): Promise<number[]> {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0);
    return Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
  }, png.toString('base64'));
}

/** A 3D `.cube` of a function, at a grid size. */
function cube(size: number, f: (r: number, g: number, b: number) => number[]): string {
  const rows = ['TITLE "Test"', `LUT_3D_SIZE ${String(size)}`];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        rows.push(
          f(r / (size - 1), g / (size - 1), b / (size - 1))
            .map((v) => v.toFixed(6))
            .join(' '),
        );
      }
    }
  }
  return `${rows.join('\n')}\n`;
}

async function open(page: Page, isMobile: boolean, lut: string, name = 'look.cube') {
  await page.goto('/lut-preview');
  const image = await swatch(page);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('button', { name: 'Apply LUT', exact: true })).toBeDisabled();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^LUT/ }).click();
  await (isMobile ? sheet : page.getByRole('region', { name: 'Settings' }))
    .locator('input[type=file][aria-label="LUT"]')
    .setInputFiles({ name, mimeType: '', buffer: Buffer.from(lut) });
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  return image;
}

async function apply(page: Page) {
  await page.getByRole('button', { name: 'Apply LUT', exact: true }).click();
  return download(page);
}

async function download(page: Page) {
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('an identity LUT leaves every pixel as it was', async ({ page, isMobile }) => {
  const image = await open(
    page,
    isMobile,
    cube(17, (r, g, b) => [r, g, b]),
  );
  const out = await apply(page);
  expect(out.name).toBe('frame_graded.png');
  expect(await pixels(page, out.bytes)).toEqual(await pixels(page, image));
  await expect(
    page.getByText('Test · 17³ cube applied at 100%').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('a known LUT matches its reference within 1/255, and intensity blends it', async ({
  page,
  isMobile,
}) => {
  // Each channel takes the next one's value, and green is lifted: a cube of 9 points.
  const f = (r: number, g: number, b: number) => [g, Math.min(1, b * 0.5 + 0.25), r];
  const image = await open(page, isMobile, cube(9, f));
  const before = await pixels(page, image);
  const full = await pixels(page, (await apply(page)).bytes);
  let worst = 0;
  for (let i = 0; i < before.length; i += 4) {
    const want = f((before[i] ?? 0) / 255, (before[i + 1] ?? 0) / 255, (before[i + 2] ?? 0) / 255);
    for (let c = 0; c < 3; c += 1) {
      worst = Math.max(worst, Math.abs((full[i + c] ?? 0) - (want[c] ?? 0) * 255));
    }
  }
  expect(worst).toBeLessThanOrEqual(1);
  // Half way, redone as the slider moves: the average of before and after, within a level.
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^LUT/ }).click();
  await (isMobile ? sheet : page).getByRole('slider', { name: 'Intensity' }).fill('50');
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  await expect(
    page.getByText('Test · 9³ cube applied at 50%').filter({ visible: true }),
  ).toBeVisible();
  const half = await pixels(page, (await download(page)).bytes);
  let off = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (i % 4 === 3) continue;
    off = Math.max(off, Math.abs((half[i] ?? 0) - ((before[i] ?? 0) + (full[i] ?? 0)) / 2));
  }
  expect(off).toBeLessThanOrEqual(1);
});

test('a broken .cube says what is wrong and on which line', async ({ page, isMobile }) => {
  await open(page, isMobile, 'LUT_3D_SIZE 2\n0 0 0\n1 0 zero\n', 'broken.cube');
  await page.getByRole('button', { name: 'Apply LUT', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Line 3: expected three numbers' }),
  ).toBeVisible();
});

test('each new result lets the last one go, and so does Start over', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the shell’s own housekeeping, the same on phones');
  // Every result is a Blob (the input and the LUT are Files): count the URLs still open.
  await page.addInitScript(() => {
    const open = new Set<string>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = create(object);
      if (object instanceof Blob && !(object instanceof File)) open.add(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      open.delete(url);
      revoke(url);
    };
    (window as unknown as { openResults: () => number }).openResults = () => open.size;
  });
  const openResults = () =>
    page.evaluate(() => (window as unknown as { openResults: () => number }).openResults());
  await open(
    page,
    false,
    cube(5, (r, g, b) => [b, r, g]),
  );
  await apply(page);
  for (const level of ['80', '60', '40']) {
    await page.getByRole('slider', { name: 'Intensity' }).fill(level);
    await expect(
      page.getByText(`Test · 5³ cube applied at ${level}%`).filter({ visible: true }),
    ).toBeVisible();
  }
  // Four results so far; the three replaced ones go after a second's grace.
  await expect.poll(openResults, { timeout: 5000 }).toBe(1);
  // The one shown still downloads.
  expect((await download(page)).bytes.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Start over' }).first().click();
  await expect.poll(openResults, { timeout: 5000 }).toBe(0);
});
