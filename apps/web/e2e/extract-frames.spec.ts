import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, pick, test } from './fixtures';

// V10 Extract Frames / Thumbnail (tools/video.md → Tests): the exact frame at a
// time, and a 4 × 4 contact sheet's layout. The VP9 fixture, as Playwright's
// Chromium has no H.264 decoder: 256 × 144 at 30 fps, a frame every 33.3 ms.

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/video/${name}`, import.meta.url));

async function open(page: Page) {
  await page.goto('/extract-frames');
  const supported = await page.evaluate(
    async () =>
      (
        await VideoDecoder.isConfigSupported({
          codec: 'vp09.00.10.08',
          codedWidth: 256,
          codedHeight: 144,
        })
      ).supported === true,
  );
  test.skip(!supported, 'needs a VP9 decoder');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(fixture('clip-vp9-opus.webm'));
  await expect(page.getByText(/256 × 144 px · 30 fps/).filter({ visible: true })).toBeVisible();
}

async function setIn(page: Page, time: string) {
  await page.getByRole('textbox', { name: 'In point' }).fill(time);
  await page.getByRole('textbox', { name: 'In point' }).press('Enter');
}

async function extract(page: Page) {
  await page.getByRole('button', { name: 'Extract frames', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** A PNG's width and height, from its header. */
const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

test('the frame on screen at a time, exactly: the In point snaps to a frame, and that frame is taken', async ({
  page,
}) => {
  await open(page);
  await setIn(page, '5.4');
  const at = await extract(page);
  expect(at.name).toBe('clip-vp9-opus_00-00-05.400.png');
  expect(pngSize(at.bytes)).toEqual([256, 144]);

  await page.getByRole('button', { name: 'Start over' }).first().click();
  await open(page);
  // 5.41 s snaps to the same frame, 5.400; 5.44 s to the next, 5.433.
  await setIn(page, '5.41');
  const same = await extract(page);
  expect(same.name).toBe('clip-vp9-opus_00-00-05.400.png');
  expect(same.bytes.equals(at.bytes)).toBe(true);

  await page.getByRole('button', { name: 'Start over' }).first().click();
  await open(page);
  await setIn(page, '5.44');
  const next = await extract(page);
  expect(next.name).toBe('clip-vp9-opus_00-00-05.433.png');
  expect(next.bytes.equals(at.bytes)).toBe(false);
});

test('a 4 × 4 contact sheet: sixteen frames in a grid with gaps', async ({ page, isMobile }) => {
  await open(page);
  await pick(page, isMobile, 'Take', 'sheet');
  const out = await extract(page);
  expect(out.name).toBe('clip-vp9-opus_sheet.png');
  // 4 × 256 px plus 5 gaps of 8 px across; 4 × 144 px plus 5 gaps down.
  expect(pngSize(out.bytes)).toEqual([4 * 256 + 5 * 8, 4 * 144 + 5 * 8]);
  await expect(page.getByText(/^16 frames, 4 × 4, from /).first()).toBeAttached();
});

test('a frame every 5 seconds, named by time, in a ZIP', async ({ page, isMobile }) => {
  await open(page);
  await pick(page, isMobile, 'Take', 'interval');
  const out = await extract(page);
  expect(out.name).toBe('clip-vp9-opus_frames.zip');
  const names: string[] = [];
  let at = 0;
  while (out.bytes.readUInt32LE(at) === 0x04034b50) {
    const size = out.bytes.readUInt32LE(at + 18);
    const nameLength = out.bytes.readUInt16LE(at + 26);
    const extra = out.bytes.readUInt16LE(at + 28);
    names.push(out.bytes.toString('utf8', at + 30, at + 30 + nameLength));
    at += 30 + nameLength + extra + size;
  }
  expect(names).toEqual(
    [0, 5, 10, 15, 20, 25].map((s) => `clip-vp9-opus_00-00-${String(s).padStart(2, '0')}.000.png`),
  );
});
