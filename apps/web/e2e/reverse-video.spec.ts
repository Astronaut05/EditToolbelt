import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoPackets } from '@etb/engines';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// V18 Reverse Video (tools/video.md): frame i of the result is frame N−1−i
// of the clip, across the stretches it's read in (90 frames, so this 120
// frame clip is two, split between keyframes); the sound is reversed too, or
// left out.

const MKV = fileURLToPath(new URL('../../../fixtures/video/clip-vp9-opus.mkv', import.meta.url));
const FPS = 30;
const FRAMES = 120;

async function drop(page: Page) {
  await page.goto('/reverse-video');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(MKV);
  await expect(
    page
      .getByText(/256 × 144/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
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

/** Where the 1,760 Hz beeps are, seconds: 20 ms windows of the first channel crossing zero fast. */
async function beeps(page: Page, bytes: Buffer): Promise<number[]> {
  return page.evaluate(async (data) => {
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(raw.buffer);
    const x = audio.getChannelData(0);
    const size = Math.round(audio.sampleRate * 0.02);
    const found: number[] = [];
    for (let a = 0; a + size <= x.length; a += size) {
      let crossings = 0;
      for (let i = a + 1; i < a + size; i += 1) {
        if ((x[i - 1] ?? 0) < 0 !== (x[i] ?? 0) < 0) crossings += 1;
      }
      // 440 Hz crosses about 880 times a second; the beep, about 3,520.
      if (crossings / 0.02 > 2_500) found.push((a + size / 2) / audio.sampleRate);
    }
    return found;
  }, bytes.toString('base64'));
}

test('frame i is the source’s frame N−1−i, and the sound runs backwards with it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await drop(page);
  const out = await run(page);
  expect(out.name).toBe('clip-vp9-opus_reversed.mkv');
  const info = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(info.durationSec - 4)).toBeLessThan(1 / FPS + 0.03);
  expect(info.video?.fps).toBe(FPS);
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(FRAMES);

  // Either side of the join between the stretches (frames 29 and 30 of the result), and further in.
  const checked = [5, 29, 30, 60, 100];
  const result = await frames(page, out.bytes, checked);
  const sourceIndexes = checked.flatMap((i) => {
    const j = FRAMES - 1 - i;
    return [j, Math.max(0, j - 3), Math.min(FRAMES - 1, j + 3), i];
  });
  const source = await frames(page, readFileSync(MKV), sourceIndexes);
  checked.forEach((i, k) => {
    const [same, before, after, unreversed] = source.slice(k * 4, k * 4 + 4);
    const d = distance(result[k], same);
    expect(d, `frame ${String(i)}`).toBeLessThan(distance(result[k], before));
    expect(d, `frame ${String(i)}`).toBeLessThan(distance(result[k], after));
    if (Math.abs(FRAMES - 1 - 2 * i) > 6) {
      expect(d, `frame ${String(i)}`).toBeLessThan(distance(result[k], unreversed));
    }
  });

  // The beeps start each second in the source; backwards, they end each second.
  const heard = await beeps(page, out.bytes);
  expect(heard.length).toBeGreaterThan(0);
  for (const t of heard) {
    const into = t - Math.floor(t);
    expect(into > 0.85 || into < 0.02, `beep at ${t.toFixed(3)} s`).toBe(true);
  }
  await expect(
    page.getByText('Sound reversed with the picture').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('the sound can be left out', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await drop(page);
  await choose(page, isMobile, 'Sound', 'Leave it out');
  const out = await run(page);
  const info = await probeMedia(new Blob([out.bytes]));
  expect(info.audio).toHaveLength(0);
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(FRAMES);
});
