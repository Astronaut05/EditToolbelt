import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoPackets } from '@etb/engines';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// V19 Loop Video (tools/video.md): 3 copies are the clip's own packets three
// times; a length cuts the last copy; a boomerang plays forwards, then back.
// The clip: 4 s of VP9 + Opus at 30 fps, 120 frames.

const MKV = fileURLToPath(new URL('../../../fixtures/video/clip-vp9-opus.mkv', import.meta.url));
const FPS = 30;
const FRAMES = 120;

async function drop(page: Page) {
  await page.goto('/loop-video');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(MKV);
  await expect(
    page
      .getByText(/256 × 144/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
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

/** Frames `indexes` of a clip, as small greyscale thumbnails, played and drawn by the page. */
async function frames(page: Page, bytes: Buffer, indexes: number[]): Promise<number[][]> {
  return page.evaluate(
    async ({ data, indexes, fps }) => {
      const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(new Blob([raw], { type: 'video/webm' }));
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      const canvas = new OffscreenCanvas(64, 36);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no canvas');
      const out: number[][] = [];
      for (const index of indexes) {
        // "seeked" can fire before the new frame is shown: wait until it is presented.
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          video.requestVideoFrameCallback(finish);
          video.onseeked = () => setTimeout(finish, 1000);
          video.currentTime = (index + 0.5) / fps;
        });
        ctx.drawImage(video, 0, 0, 64, 36);
        const px = ctx.getImageData(0, 0, 64, 36).data;
        const grey: number[] = [];
        for (let i = 0; i < px.length; i += 4) {
          grey.push(((px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0)) / 3);
        }
        out.push(grey);
      }
      URL.revokeObjectURL(video.src);
      return out;
    },
    { data: bytes.toString('base64'), indexes, fps: FPS },
  );
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
