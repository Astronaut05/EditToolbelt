import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// C07 Gradient Generator (tools/color.md): the CSS for each kind, smooth vs
// plain, and a PNG that matches what the browser draws from that CSS.

/** An image's size, and its colour at fractions of the way across and down, read in the page. */
async function pixels(
  page: Page,
  bytes: Buffer,
  points: readonly (readonly [number, number])[] = [],
) {
  return page.evaluate(
    async ([b64, at]) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0);
      const colors = at.map(([fx, fy]) => {
        const x = Math.min(bitmap.width - 1, Math.floor(fx * bitmap.width));
        const y = Math.min(bitmap.height - 1, Math.floor(fy * bitmap.height));
        return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      });
      return { width: bitmap.width, height: bitmap.height, colors };
    },
    [bytes.toString('base64'), points] as const,
  );
}

const css = (page: Page) => page.getByTestId('gradient-css');

async function savePng(page: Page) {
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save PNG/ }).click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

async function fill(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
}

test('smooth spells out the Oklch blend; plain is the two stops', async ({ page }) => {
  await page.goto('/gradient-generator');
  await expect(css(page)).toContainText('linear-gradient(90deg, #2563eb 0%');
  expect(((await css(page).textContent()) ?? '').match(/#[0-9a-f]{6} [\d.]+%/g)).toHaveLength(11);
  await page.getByRole('radio', { name: 'Plain · sRGB' }).click();
  await expect(css(page)).toHaveText(
    'background-image: linear-gradient(90deg, #2563eb 0%, #f97316 100%);',
  );
  await expect(page).toHaveURL(/m=plain/);
  expect(await cspViolations(page)).toEqual([]);
});

test('stops can be added, edited and removed, and the state lives in the URL', async ({ page }) => {
  await page.goto('/gradient-generator?m=plain&k=conic&a=45');
  await expect(css(page)).toHaveText(
    'background-image: conic-gradient(from 45deg, #2563eb 0%, #f97316 100%);',
  );
  await page.getByRole('button', { name: 'Add a stop' }).click();
  await expect(css(page)).toContainText(' 50%, #f97316 100%');
  await expect(page.getByLabel('Stop 3', { exact: true })).toHaveValue('#f97316');
  await fill(page, 'Stop 2', '#00ff00');
  await expect(css(page)).toHaveText(
    'background-image: conic-gradient(from 45deg, #2563eb 0%, #00ff00 50%, #f97316 100%);',
  );
  // The URL is written once typing pauses.
  await expect(page).toHaveURL(/00ff00/);
  await page.reload();
  await expect(css(page)).toContainText('#00ff00 50%');
  await page.getByRole('button', { name: 'Remove stop 2' }).click();
  await expect(css(page)).toHaveText(
    'background-image: conic-gradient(from 45deg, #2563eb 0%, #f97316 100%);',
  );
  // A color it can't read says so.
  await fill(page, 'Stop 1', 'not a colour');
  await expect(page.getByText(/^Stop 1: /)).toBeVisible();
});

test('the PNG is the size asked for and matches what the browser draws from the CSS', async ({
  page,
}) => {
  for (const [kind, angle] of [
    ['linear', '30'],
    ['radial', '0'],
    ['conic', '0'],
  ] as const) {
    await page.goto(
      `/gradient-generator?m=plain&k=${kind}&a=${angle}&s=ff0000@0,ffff00@40,0000ff@100&w=400&h=200`,
    );
    const out = await savePng(page);
    expect(out.name).toBe('gradient-400x200.png');
    const points = [
      [0.2, 0.3],
      [0.8, 0.7],
      [0.35, 0.8],
      [0.7, 0.15],
    ] as const;
    const png = await pixels(page, out.bytes, points);
    expect([png.width, png.height]).toEqual([400, 200]);
    // The preview has the PNG's shape, so the same fractions land on the same spots.
    // Centred first, clear of the sticky site header.
    const preview = page.getByRole('img', { name: `Preview of the ${kind} gradient` });
    await preview.evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
    });
    const shown = await pixels(page, await preview.screenshot(), points);
    points.forEach(([fx, fy], i) => {
      const a = png.colors[i] ?? [];
      const b = shown.colors[i] ?? [];
      for (let c = 0; c < 3; c += 1) {
        expect(
          Math.abs((a[c] ?? 0) - (b[c] ?? 0)),
          `${kind} at ${String(fx)}, ${String(fy)}`,
        ).toBeLessThanOrEqual(12);
      }
    });
  }
});

test('smooth keeps the middle of red to blue a clear purple', async ({ page }) => {
  await page.goto('/gradient-generator?s=ff0000@0,0000ff@100&w=200&h=10');
  const middle = [[0.5, 0.5]] as const;
  const smooth = await pixels(page, (await savePng(page)).bytes, middle);
  await page.getByRole('radio', { name: 'Plain · sRGB' }).click();
  const plain = await pixels(page, (await savePng(page)).bytes, middle);
  const [r1 = 0, , b1 = 0] = smooth.colors[0] ?? [];
  const [r2 = 0, , b2 = 0] = plain.colors[0] ?? [];
  // sRGB meets at about (128, 0, 128); Oklch at a brighter, cleaner purple.
  expect(r2).toBeLessThan(140);
  expect(r1 + b1).toBeGreaterThan(r2 + b2 + 60);
});
