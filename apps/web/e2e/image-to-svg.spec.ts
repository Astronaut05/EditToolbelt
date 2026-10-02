import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// P19 Image to SVG (tools/photo.md): a logo drawn by the browser, anti-aliased
// edges and all, traced to an SVG of filled paths only, which draws back
// within a hair of the original; then the same logo in black and white.

/** A 300 × 200 PNG logo: a red disc and a blue bar on white, drawn with the canvas's smooth edges. */
async function logo(page: Page) {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(300, 200);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 300, 200);
    ctx.fillStyle = '#d42a2a';
    ctx.beginPath();
    ctx.arc(95, 100, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f4fb8';
    ctx.save();
    ctx.translate(225, 100);
    ctx.rotate(0.3);
    ctx.fillRect(-30, -70, 60, 140);
    ctx.restore();
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** The share of pixels where the SVG, drawn by the browser, differs from the PNG by more than a little. */
async function mismatch(page: Page, png: Buffer, svg: string) {
  return page.evaluate(
    async ([pngBase64, svgText]) => {
      const draw = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = new OffscreenCanvas(300, 200);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 300, 200);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, 300, 200).data;
      };
      const before = await draw(`data:image/png;base64,${pngBase64}`);
      const after = await draw(`data:image/svg+xml,${encodeURIComponent(svgText)}`);
      let off = 0;
      for (let i = 0; i < before.length; i += 4) {
        const d =
          Math.abs((before[i] ?? 0) - (after[i] ?? 0)) +
          Math.abs((before[i + 1] ?? 0) - (after[i + 1] ?? 0)) +
          Math.abs((before[i + 2] ?? 0) - (after[i + 2] ?? 0));
        if (d > 90) off += 1;
      }
      return off / (before.length / 4);
    },
    [png.toString('base64'), svg] as const,
  );
}

async function download(page: Page) {
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
}

test('a logo becomes an SVG of filled paths that draws back like the original', async ({
  page,
  isMobile,
}) => {
  await page.goto('/image-to-svg');
  const png = await logo(page);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Make SVG', exact: true }).click();
  const svg = await download(page);
  expect(svg.name).toBe('logo.svg');
  expect(svg.text).toMatch(
    /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="300" height="200" viewBox="0 0 300 200">/,
  );
  // Nothing but paths: no scripts, images, links or styles.
  expect(new Set(svg.text.match(/<\w+/g))).toEqual(new Set(['<svg', '<path']));
  // White, red and blue: the soft edges joined the shapes rather than adding rings of their own.
  expect(svg.text.match(/<path/g)).toHaveLength(3);
  expect(await mismatch(page, png, svg.text)).toBeLessThan(0.01);

  // Black and white: traced again as soon as it's picked, the white left out.
  await choose(page, isMobile, 'Mode', 'Black and white');
  await expect(
    page.getByText('Black shapes, the white left transparent').filter({ visible: true }),
  ).toBeVisible({ timeout: 30_000 });
  const bw = await download(page);
  expect(bw.text.match(/<path fill="([^"]+)"/g)).toEqual(['<path fill="#000000"']);
  expect(await cspViolations(page)).toEqual([]);
});
