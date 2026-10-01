import { readFileSync } from 'node:fs';

import {
  format3dl,
  formatCube,
  identityLut,
  lookup,
  parse3dl,
  parseCube,
  type Lut,
} from '@etb/core';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// C06 LUT Converter (tools/color.md): .cube → .3dl and back, a grid resized,
// a curves-only cube made 1D, and one that mixes channels refused.

/** A 3D LUT from a function, red changing fastest. */
function cubeOf(
  size: number,
  f: (r: number, g: number, b: number) => [number, number, number],
): Lut {
  const lut = identityLut(size);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lut.table.set(
          f(r / (size - 1), g / (size - 1), b / (size - 1)),
          ((b * size + g) * size + r) * 3,
        );
      }
    }
  }
  return lut;
}

const warm = (r: number, g: number, b: number): [number, number, number] => [
  Math.min(1, r * 0.9 + g * 0.1),
  g ** 1.1,
  b * 0.8,
];

/** The largest difference between two LUTs over a 9³ sample of colours. */
function maxDiff(a: Lut, b: Lut): number {
  const x = new Float32Array(3);
  const y = new Float32Array(3);
  let most = 0;
  for (let i = 0; i < 9; i += 1) {
    for (let j = 0; j < 9; j += 1) {
      for (let k = 0; k < 9; k += 1) {
        lookup(a, i / 8, j / 8, k / 8, x);
        lookup(b, i / 8, j / 8, k / 8, y);
        for (let c = 0; c < 3; c += 1) most = Math.max(most, Math.abs((x[c] ?? 0) - (y[c] ?? 0)));
      }
    }
  }
  return most;
}

async function drop(page: Page, name: string, text: string) {
  await page.goto('/lut-converter');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
}

async function convert(page: Page) {
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
}

test('a .cube becomes a .3dl that grades the same, within a 12-bit step', async ({
  page,
  isMobile,
}) => {
  const lut = cubeOf(5, warm);
  await drop(page, 'warm.cube', formatCube(lut, 'Warm'));
  const out = await convert(page);
  expect(out.name).toBe('warm.3dl');
  const lines = out.text.trim().split('\n');
  expect(lines[0]).toBe('0 256 512 767 1023');
  expect(lines).toHaveLength(1 + 125);
  expect(maxDiff(lut, parse3dl(out.text))).toBeLessThan(1 / 4095 + 1e-6);
  // What it was, in the readout beside the result (a desktop column).
  if (!isMobile) {
    await expect(page.getByText('.cube · 3D, 5³').filter({ visible: true }).first()).toBeVisible();
  }
  expect(await cspViolations(page)).toEqual([]);
});

test('a .3dl becomes a 33-point .cube', async ({ page, isMobile }) => {
  const original = cubeOf(17, warm);
  const { text } = format3dl(original);
  await drop(page, 'film.3dl', text);
  await choose(page, isMobile, 'Convert to', '.cube');
  await choose(page, isMobile, 'Grid', '33');
  const out = await convert(page);
  expect(out.name).toBe('film_33.cube');
  const back = parseCube(out.text);
  expect([back.dimensions, back.size]).toEqual([3, 33]);
  expect(maxDiff(original, back)).toBeLessThan(0.01);
});

test('a cube of curves becomes 1D; one that mixes channels says why it can’t', async ({
  page,
  isMobile,
}) => {
  const curves = cubeOf(9, (r, g, b) => [r ** 0.9, g ** 1.1, b]);
  await drop(page, 'curves.cube', formatCube(curves, 'Curves'));
  await choose(page, isMobile, 'Convert to', '.cube');
  await choose(page, isMobile, 'Grid', '1D curves');
  const out = await convert(page);
  const flat = parseCube(out.text);
  expect([flat.dimensions, flat.size]).toEqual([1, 9]);
  expect(maxDiff(curves, flat)).toBeLessThan(1e-5);

  await drop(page, 'warm.cube', formatCube(cubeOf(9, warm), 'Warm'));
  await choose(page, isMobile, 'Convert to', '.cube');
  await choose(page, isMobile, 'Grid', '1D curves');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(
    page
      .getByText(/mixes the channels/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});

test('a file that isn’t a LUT says where it went wrong', async ({ page }) => {
  await drop(page, 'broken.cube', 'LUT_3D_SIZE 2\n0 0 0\nnot numbers\n');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(
    page
      .getByText(/can’t be read\. Line 3:/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});
