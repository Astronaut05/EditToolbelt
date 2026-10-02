import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoPackets } from '@etb/engines';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, pick, test } from './fixtures';

// V13 Change Video Speed (tools/video.md → Tests): 2× halves the length
// within a frame, and the sound keeps its pitch. The pitch is compared by
// zero crossings per second of sound, decoded in the page: the same as the
// source's when kept, twice it when shifted at 2×.

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/video/${name}`, import.meta.url));
const WEBM = fixture('clip-vp9-opus.webm');
const MKV = fixture('clip-vp9-opus.mkv');

async function drop(page: Page, path: string) {
  await page.goto('/video-speed');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(path);
  await expect(
    page
      .getByText(/256 × 144/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Change speed', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** Zero crossings per second of the first channel, over the middle of the sound. */
async function crossingsPerSecond(page: Page, bytes: Buffer): Promise<number> {
  return page.evaluate(async (data) => {
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(raw.buffer);
    const x = audio.getChannelData(0);
    const a = Math.floor(x.length * 0.1);
    const b = Math.floor(x.length * 0.9);
    let crossings = 0;
    for (let i = a + 1; i < b; i += 1) if ((x[i - 1] ?? 0) < 0 !== (x[i] ?? 0) < 0) crossings += 1;
    return crossings / ((b - a) / audio.sampleRate);
  }, bytes.toString('base64'));
}

test('2× halves the length, copies every frame, and keeps the sound’s pitch', async ({ page }) => {
  await drop(page, WEBM);
  const out = await run(page);
  expect(out.name).toBe('clip-vp9-opus_speed.webm');
  const source = readFileSync(WEBM);
  const before = await probeMedia(new Blob([source]));
  const after = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(after.durationSec - before.durationSec / 2)).toBeLessThan(1 / 30 + 0.03);
  expect(after.video?.fps).toBe(60);
  // Every frame, byte for byte.
  const packets = await videoPackets(new Blob([out.bytes]));
  const original = await videoPackets(new Blob([source]));
  expect(packets.length).toBe(original.length);
  expect(packets.every((p, i) => Buffer.from(p).equals(Buffer.from(original[i] ?? [])))).toBe(true);
  // The same pitch: crossings per second within 5% of the source's.
  const ratio =
    (await crossingsPerSecond(page, out.bytes)) / (await crossingsPerSecond(page, source));
  expect(Math.abs(ratio - 1)).toBeLessThan(0.05);
  expect(await cspViolations(page)).toEqual([]);
});

test('shifting the pitch at 2× doubles it, like tape', async ({ page, isMobile }) => {
  await drop(page, WEBM);
  await choose(page, isMobile, 'Sound', 'Shift pitch');
  const out = await run(page);
  const ratio =
    (await crossingsPerSecond(page, out.bytes)) /
    (await crossingsPerSecond(page, readFileSync(WEBM)));
  expect(Math.abs(ratio - 2)).toBeLessThan(0.1);
});

test('0.5× keeping the frame rate redraws it at 30 fps, twice as long', async ({
  page,
  isMobile,
}) => {
  await drop(page, MKV);
  await pick(page, isMobile, 'Speed', '0.5');
  await choose(page, isMobile, 'Sound', 'Keep frame rate');
  const out = await run(page);
  const info = await probeMedia(new Blob([out.bytes]));
  expect(info.video).toMatchObject({ fps: 30, variableFrameRate: false });
  expect(Math.abs(info.durationSec - 8)).toBeLessThan(1 / 30 + 0.03);
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(240);
});

test('keeping the frame rate rounds an odd size to even, as H.264 encoders need', async ({
  page,
  isMobile,
}) => {
  await page.goto('/video-speed');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(fixture('clip-vp9-odd.webm'));
  await expect(
    page
      .getByText(/255 × 143/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await choose(page, isMobile, 'Sound', 'Keep frame rate');
  const out = await run(page);
  const info = await probeMedia(new Blob([out.bytes]));
  expect(info.video).toMatchObject({ width: 256, height: 144, fps: 30 });
  // 2 s at 2×: 1 s of frames at 30 fps.
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(30);
  await expect(page.getByText(/at 256 × 144 px: encoders take even sizes/).first()).toBeAttached();
});
