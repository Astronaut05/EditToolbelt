import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoFrameSource, videoPackets } from '@etb/engines';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, framePixels, test } from './fixtures';

// V19 Loop Video (tools/video.md): 3 copies are the clip's own packets three
// times; a length cuts the last copy; a boomerang plays forwards, then back.
// The clip: 4 s of VP9 + Opus at 30 fps, 120 frames.

const MKV = fileURLToPath(new URL('../../../fixtures/video/clip-vp9-opus.mkv', import.meta.url));
/** 2 s at 255 × 143 px, 60 frames on an irregular clock (fixtures/video/README.md). */
const VFR = fileURLToPath(new URL('../../../fixtures/video/clip-vfr-odd.mkv', import.meta.url));
const FPS = 30;
const FRAMES = 120;

async function drop(page: Page, file = MKV, size = /256 × 144/) {
  await page.goto('/loop-video');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(file);
  await expect(page.getByText(size).filter({ visible: true }).first()).toBeVisible();
}

/** The time between each frame and the next, in the order shown (the packets, read in Node). */
async function gaps(bytes: Buffer<ArrayBuffer>): Promise<number[]> {
  const source = await videoFrameSource(new Blob([bytes]), 0, 3600);
  const times = (source?.packets ?? []).map((p) => p.timestamp).sort((a, b) => a - b);
  return times.slice(1).map((t, i) => t - (times[i] ?? 0));
}

/** Sets a number setting: in place on desktop, in its settings sheet on phones. */
async function setNumber(page: Page, isMobile: boolean, label: string, value: string) {
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Repeat/ }).click();
  await (isMobile ? sheet : page).getByRole('spinbutton', { name: label }).fill(value);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** Frames `indexes` of a clip, as 64 × 36 greyscale thumbnails (decoded with WebCodecs, see framePixels). */
async function frames(page: Page, bytes: Buffer, indexes: number[]): Promise<number[][]> {
  const { frames: rgba } = await framePixels(
    page,
    bytes,
    indexes.map((index) => (index + 0.5) / FPS),
    { width: 64, height: 36 },
  );
  return rgba.map((px) => {
    const grey: number[] = [];
    for (let i = 0; i < px.length; i += 4) {
      grey.push(((px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0)) / 3);
    }
    return grey;
  });
}

const distance = (a: number[] | undefined, b: number[] | undefined) =>
  (a ?? []).reduce((sum, v, i) => sum + Math.abs(v - (b?.[i] ?? 0)), 0) / (a?.length ?? 1);

test('3 times is the clip’s own packets three times over, copied as they are', async ({
  page,
  isMobile,
}) => {
  await drop(page);
  // The result before starting, beside the file's details (a desktop column).
  if (!isMobile) {
    await expect(page.getByText('3 × 4.0 s').filter({ visible: true }).first()).toBeVisible();
  }
  const out = await run(page);
  expect(out.name).toBe('clip-vp9-opus_loop.mkv');
  const info = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(info.durationSec - 12)).toBeLessThan(1 / FPS + 0.03);
  expect(info.audio).toHaveLength(1);
  const packets = await videoPackets(new Blob([out.bytes]));
  const original = await videoPackets(new Blob([readFileSync(MKV)]));
  expect(packets.length).toBe(3 * FRAMES);
  expect(
    packets.every((p, i) => Buffer.from(p).equals(Buffer.from(original[i % FRAMES] ?? []))),
  ).toBe(true);
  await expect(
    page.getByText('Copied without re-encoding: instant and lossless').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('a length of 10 s cuts the third copy after 2 s, still copied', async ({ page, isMobile }) => {
  await drop(page);
  await choose(page, isMobile, 'Repeat', 'To a length');
  await setNumber(page, isMobile, 'Length', '10');
  const out = await run(page);
  const info = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(info.durationSec - 10)).toBeLessThan(1 / FPS + 0.03);
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(10 * FPS);
  await expect(
    page.getByText(/the last loop cut at the length/).filter({ visible: true }),
  ).toBeVisible();
});

test('a boomerang plays forwards, then back without repeating the turns', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  await drop(page);
  await choose(page, isMobile, 'Boomerang', 'Forwards, then back');
  const out = await run(page);
  // Each loop: frames 0–119, then 118 down to 1. Three loops, the default.
  const perLoop = FRAMES + FRAMES - 2;
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(3 * perLoop);
  const info = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(info.durationSec - (3 * perLoop) / FPS)).toBeLessThan(1 / FPS + 0.03);
  expect(info.audio).toHaveLength(1);
  // Output frame → source frame: 30 → 30, 125 → 113, 200 → 38, 240 → 2.
  const checked: [number, number][] = [
    [30, 30],
    [125, 113],
    [200, 38],
    [240, 2],
  ];
  const result = await frames(
    page,
    out.bytes,
    checked.map(([k]) => k),
  );
  const source = await frames(
    page,
    readFileSync(MKV),
    checked.flatMap(([, j]) => [j, Math.max(0, j - 4), Math.min(FRAMES - 1, j + 4)]),
  );
  checked.forEach(([k], n) => {
    const [same, before, after] = source.slice(n * 3, n * 3 + 3);
    const d = distance(result[n], same);
    expect(d, `frame ${String(k)}`).toBeLessThan(distance(result[n], before));
    expect(d, `frame ${String(k)}`).toBeLessThan(distance(result[n], after));
  });
  await expect(
    page.getByText('Sound forwards, then backwards, with the picture').filter({ visible: true }),
  ).toBeVisible();
});

test('a variable frame rate is kept, copied or encoded again, and an odd size is made even', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(180_000);
  const source = await gaps(readFileSync(VFR));
  const n = source.length + 1;
  // Copied 3 times: each copy's frames at their own times, not snapped to a 30 fps grid.
  await drop(page, VFR, /255 × 143/);
  const copied = await gaps((await run(page)).bytes);
  expect(copied).toHaveLength(3 * n - 1);
  for (let copy = 0; copy < 3; copy += 1) {
    source.forEach((gap, i) => {
      expect(
        Math.abs((copied[copy * n + i] ?? 0) - gap),
        `copy ${String(copy)}, gap ${String(i)}`,
      ).toBeLessThan(0.0015);
    });
  }
  // A boomerang is encoded again: an even size, and the frames forwards keep their times.
  await drop(page, VFR, /255 × 143/);
  await choose(page, isMobile, 'Boomerang', 'Forwards, then back');
  const out = await run(page);
  const info = await probeMedia(new Blob([out.bytes]));
  expect([info.video?.width, info.video?.height]).toEqual([256, 144]);
  const boomerang = await gaps(out.bytes);
  source.forEach((gap, i) => {
    expect(Math.abs((boomerang[i] ?? 0) - gap), `gap ${String(i)}`).toBeLessThan(0.0015);
  });
});
