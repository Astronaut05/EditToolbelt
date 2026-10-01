import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoPackets } from '@etb/engines';
import type { Download, Page } from '@playwright/test';

import { choose, expect, pick, test } from './fixtures';

// V11 Rotate & Flip Video and V09 Resize & Crop Video for Social (tools/video.md
// → Tests). Outputs are read back in Node with the engine's own probe, and the
// framing by drawing the result's frames in the page. Playwright's Chromium has
// no H.264 encoder, so re-encoding steps use the VP9 fixtures.

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/video/${name}`, import.meta.url));

async function drop(page: Page, name: string) {
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(fixture(name));
}

async function run(page: Page, button: string): Promise<Download> {
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  return saved;
}

const probe = async (download: Download) =>
  probeMedia(new Blob([readFileSync(await download.path())]));

async function canDecodeVp9(page: Page) {
  return page.evaluate(
    async () =>
      (
        await VideoDecoder.isConfigSupported({
          codec: 'vp09.00.10.08',
          codedWidth: 256,
          codedHeight: 144,
        })
      ).supported === true,
  );
}

/**
 * The mean colour of each third of a frame, left to right, at `time` s, from a
 * video file played in the page.
 */
async function thirds(page: Page, file: Buffer, type: string, time: number) {
  return page.evaluate(
    async ({ data, type: mime, at }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(new Blob([bytes], { type: mime }));
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      video.currentTime = at;
      await new Promise((resolve) => {
        video.onseeked = resolve;
      });
      const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(video, 0, 0);
      const { data: px, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out = [0, 1, 2].map(() => [0, 0, 0]);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const band = out[Math.min(2, Math.floor((x * 3) / width))];
          if (!band) continue;
          for (let c = 0; c < 3; c += 1)
            band[c] = (band[c] ?? 0) + (px[(y * width + x) * 4 + c] ?? 0);
        }
      }
      const per = (width / 3) * height;
      return { width, height, bands: out.map((b) => b.map((v) => v / per)) };
    },
    { data: file.toString('base64'), type, at: time },
  );
}

const distance = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((sum, v, i) => sum + (v - (b[i] ?? 0)) ** 2, 0));

test('Fast sets the rotation flag on an MP4 and copies every frame', async ({ page, isMobile }) => {
  await page.goto('/rotate-video');
  await drop(page, 'clip-h264-aac.mp4');
  await choose(page, isMobile, 'How', 'Fast, by flag');
  const file = await run(page, 'Rotate video');
  expect(file.suggestedFilename()).toBe('clip-h264-aac_rotated.mp4');
  const info = await probe(file);
  expect(info.video?.rotation).toBe(90);
  expect([info.video?.width, info.video?.height]).toEqual([144, 256]);
  const hash = (packets: Uint8Array[]) =>
    packets.map((p) => createHash('sha256').update(p).digest('hex'));
  expect(hash(await videoPackets(new Blob([readFileSync(await file.path())])))).toEqual(
    hash(await videoPackets(new Blob([readFileSync(fixture('clip-h264-aac.mp4'))]))),
  );
  await expect(page.getByText(/^Fast: the rotation flag is set/).first()).toBeAttached();
});

test('turning every frame 90° makes the picture portrait, with no flag', async ({ page }) => {
  await page.goto('/rotate-video');
  test.skip(!(await canDecodeVp9(page)), 'needs a VP9 decoder');
  await drop(page, 'clip-vp9-opus.mkv');
  const file = await run(page, 'Rotate video');
  expect(file.suggestedFilename()).toBe('clip-vp9-opus_rotated.mkv');
  const info = await probe(file);
  expect(info.video?.rotation).toBe(0);
  expect([info.video?.width, info.video?.height]).toEqual([144, 256]);
  expect(Math.abs(info.durationSec - 4)).toBeLessThan(0.1);
  expect(info.audio[0]?.codec).toBe('opus');
});

test('16:9 to 9:16 fitted on blur is exactly 1080 × 1920', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  await page.goto('/resize-video');
  test.skip(!(await canDecodeVp9(page)), 'needs a VP9 decoder');
  await drop(page, 'clip-vp9-opus.mkv');
  await choose(page, isMobile, 'Fit', 'Fit on blur');
  const file = await run(page, 'Resize video');
  expect(file.suggestedFilename()).toBe('clip-vp9-opus_resized.mkv');
  const info = await probe(file);
  expect([info.video?.width, info.video?.height]).toEqual([1080, 1920]);
  expect(Math.abs(info.durationSec - 4)).toBeLessThan(0.1);
});

test('the framing picks which part of the picture a crop keeps', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  await page.goto('/resize-video');
  test.skip(!(await canDecodeVp9(page)), 'needs a VP9 decoder');
  const original = readFileSync(fixture('clip-vp9-opus.webm'));
  const source = await thirds(page, original, 'video/webm', 1);
  const crop = async (x: string) => {
    await page.goto('/resize-video');
    await drop(page, 'clip-vp9-opus.webm');
    await pick(page, isMobile, 'Size', 'custom');
    // 144 × 144 from 256 × 144: a square window that slides across.
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    if (isMobile) await page.getByRole('button', { name: /^Size/ }).click();
    const scope = isMobile ? sheet : page;
    await scope.getByRole('spinbutton', { name: 'Width' }).fill('144');
    await scope.getByRole('spinbutton', { name: 'Height' }).fill('144');
    if (isMobile) await page.keyboard.press('Escape');
    if (isMobile) await page.getByRole('button', { name: /^Fit/ }).click();
    await (isMobile ? sheet : page).getByRole('slider', { name: 'Framing across' }).fill(x);
    if (isMobile) await page.keyboard.press('Escape');
    const file = await run(page, 'Resize video');
    const bytes = readFileSync(await file.path());
    const info = await probe(file);
    expect([info.video?.width, info.video?.height]).toEqual([144, 144]);
    return thirds(page, bytes, 'video/webm', 1);
  };
  const left = await crop('0');
  const right = await crop('100');
  // The left crop's first third is the source's first third, and the right crop's last third
  // the source's last: closer to those than to the far side.
  const [srcLeft, , srcRight] = source.bands;
  expect(distance(left.bands[0] ?? [], srcLeft ?? [])).toBeLessThan(
    distance(left.bands[0] ?? [], srcRight ?? []),
  );
  expect(distance(right.bands[2] ?? [], srcRight ?? [])).toBeLessThan(
    distance(right.bands[2] ?? [], srcLeft ?? []),
  );
  expect(distance(left.bands[0] ?? [], right.bands[0] ?? [])).toBeGreaterThan(10);
});
