import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, pick, setRange, test } from './fixtures';

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

/** A stored ZIP's files, in order, read from its central directory (sizes follow each file). */
function unzip(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    expect(zip.readUInt16LE(at + 10)).toBe(0);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.push({
      name: zip.toString('utf8', at + 46, at + 46 + nameLength),
      data: zip.subarray(start, start + size),
    });
    at += 46 + skip;
  }
  return files;
}

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
  const files = unzip(out.bytes);
  expect(files.map((f) => f.name)).toEqual(
    [0, 5, 10, 15, 20, 25].map((s) => `clip-vp9-opus_00-00-${String(s).padStart(2, '0')}.000.png`),
  );
  expect(files.every((f) => pngSize(f.data).join() === '256,144')).toBe(true);
});

test('more frames than the selection has: each frame once, and the repeats said', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the same engine as on desktop');
  await open(page);
  // 0.5 s at 30 fps is 15 frames; 40 evenly spaced times land on some of them twice.
  await pick(page, false, 'Take', 'count');
  await setRange(page, '1', '1.5');
  await page
    .getByRole('region', { name: 'Settings' })
    .getByRole('spinbutton', { name: 'Frames' })
    .fill('40');
  const out = await extract(page);
  const files = unzip(out.bytes);
  expect(files).toHaveLength(15);
  expect(new Set(files.map((f) => f.name)).size).toBe(15);
  expect(files[0]?.name).toBe('clip-vp9-opus_00-00-01.000.png');
  expect(files.at(-1)?.name).toBe('clip-vp9-opus_00-00-01.467.png');
  await expect(
    page.getByText('15 frames from 00:00:01.000 to 00:00:01.467', { exact: false }).first(),
  ).toBeAttached();
  await expect(page.getByText(/^25 repeats skipped/).first()).toBeAttached();
});

test('the frame goes on to Resize Image, a tool in another category, without a new upload', async ({
  page,
}) => {
  await open(page);
  await setIn(page, '5.4');
  await page.getByRole('button', { name: 'Extract frames', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Download/ }).first()).toBeEnabled({
    timeout: 60_000,
  });
  // A soft navigation: Resize Image's view and its category's index load now.
  await page
    .locator('p', { hasText: 'Next:' })
    .filter({ visible: true })
    .getByRole('link', { name: 'Resize Image', exact: true })
    .click();
  await expect(page).toHaveURL(/\/resize-image$/);
  // The frame arrives as if dropped: Resize works on it straight away.
  await page.getByRole('button', { name: 'Resize', exact: true }).first().click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('clip-vp9-opus_00-00-05.400_resized.png');
  // 256 × 144 is 16:9, so Keep ratio fills Full HD exactly.
  expect(pngSize(readFileSync(await file.path()))).toEqual([1920, 1080]);
});
