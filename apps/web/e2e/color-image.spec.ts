import { readFileSync } from 'node:fs';

import { cspViolations, expect, test } from './fixtures';

// C01 Color Palette from Image and C02 Color Picker from Image (tools/color.md → Tests).

/** A 24-bit BMP, `paint(x, y)` giving each pixel's colour. */
function bmp(width: number, height: number, paint: (x: number, y: number) => number[]): Buffer {
  const row = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * height);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * height, 34);
  // Rows are stored bottom-up.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r = 0, g = 0, b = 0] = paint(x, y);
      const at = 54 + (height - 1 - y) * row + x * 3;
      out[at] = b;
      out[at + 1] = g;
      out[at + 2] = r;
    }
  }
  return out;
}

/** Vertical colour bands, each `width` px wide and 40 px tall. */
function bands(colours: { rgb: [number, number, number]; width: number }[]): Buffer {
  const width = colours.reduce((n, c) => n + c.width, 0);
  return bmp(width, 40, (x) => {
    let left = x;
    for (const c of colours) {
      if (left < c.width) return c.rgb;
      left -= c.width;
    }
    return [0, 0, 0];
  });
}

test('4 flat colours come back as exactly those 4, most common first', async ({ page }) => {
  await page.goto('/color-palette-from-image');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'blocks.bmp',
      mimeType: 'image/bmp',
      buffer: bands([
        { rgb: [220, 40, 50], width: 40 },
        { rgb: [30, 120, 200], width: 30 },
        { rgb: [250, 200, 40], width: 20 },
        { rgb: [40, 160, 90], width: 10 },
      ]),
    });
  const palette = page.getByRole('list', { name: 'Palette' }).filter({ visible: true });
  await expect(palette.getByRole('listitem')).toHaveCount(4);
  await expect(palette.getByRole('listitem')).toHaveText([
    /#DC2832\s*40\.0%/,
    /#1E78C8\s*30\.0%/,
    /#FAC828\s*20\.0%/,
    /#28A05A\s*10\.0%/,
  ]);
  const download = page.getByRole('button', { name: /^Download/ }).first();
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('blocks_palette.css');
  const css = readFileSync(await file.path(), 'utf8');
  expect(css).toContain('--palette-1: #dc2832; /* 40.0% */');
  expect(css).toContain('--palette-4: #28a05a; /* 10.0% */');
  expect(await cspViolations(page)).toEqual([]);
});

test('the picker reads one pixel exactly, from the keyboard', async ({ page }) => {
  await page.goto('/color-picker-from-image');
  // One #123456 pixel at (17, 11) in a field of #fedcba.
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'dot.bmp',
      mimeType: 'image/bmp',
      buffer: bmp(40, 30, (x, y) => (x === 17 && y === 11 ? [18, 52, 86] : [254, 220, 186])),
    });
  const image = page.getByRole('application', { name: /^Image: point or tap/ });
  await expect(image).toBeVisible();
  await expect(page.getByText('x 20 · y 15 px · 1 px')).toBeVisible();
  await image.focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowUp');
  await expect(page.getByText('x 17 · y 11 px · 1 px')).toBeVisible();
  await page.keyboard.press('Enter');
  const picked = page.getByRole('list', { name: 'Picked colors' });
  await expect(picked.getByRole('listitem')).toHaveText([/#123456/]);
  // A neighbour, then the download holds both, oldest first.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(picked.getByRole('listitem')).toHaveText([/#FEDCBA/, /#123456/]);
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled();
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('dot_colors.css');
  expect(readFileSync(await file.path(), 'utf8')).toBe(
    ':root {\n  --picked-1: #123456;\n  --picked-2: #fedcba;\n}\n',
  );
  expect(await cspViolations(page)).toEqual([]);
});
