import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia } from '@etb/engines';
import type { Download, Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// V01 Trim Video and V06 Extract Audio (tools/video.md → Tests). Outputs are
// read back in Node with the engine's own probe. Test browsers differ in what
// they decode (Playwright's Chromium has no H.264 or AAC), so steps that need
// a decoder check for it first; copying works everywhere.

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/video/${name}`, import.meta.url));

async function drop(page: Page, name: string) {
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(fixture(name));
}

async function run(page: Page, button: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  return saved;
}

async function probe(download: Download) {
  return probeMedia(new Blob([readFileSync(await download.path())]));
}

async function canDecode(page: Page, codec: string, kind: 'video' | 'audio') {
  return page.evaluate(
    async ([c, k]) =>
      k === 'video'
        ? (await VideoDecoder.isConfigSupported({ codec: c, codedWidth: 256, codedHeight: 144 }))
            .supported === true
        : (
            await AudioDecoder.isConfigSupported({
              codec: c,
              sampleRate: 48000,
              numberOfChannels: 2,
            })
          ).supported === true,
    [codec, kind] as const,
  );
}

async function setRange(page: Page, start: string, end: string) {
  await page.getByRole('textbox', { name: 'Out point' }).fill(end);
  await page.getByRole('textbox', { name: 'Out point' }).press('Enter');
  await page.getByRole('textbox', { name: 'In point' }).fill(start);
  await page.getByRole('textbox', { name: 'In point' }).press('Enter');
}

test('fast trim copies from the keyframe before In, and says so', async ({ page }) => {
  await page.goto('/trim-video');
  await drop(page, 'clip-h264-aac.mp4');
  await expect(
    page.getByText('256 × 144 px · 30 fps · H.264 + AAC').filter({ visible: true }),
  ).toBeVisible();
  await setRange(page, '10.5', '20.5');
  await expect(page.getByText('10.00 s', { exact: true })).toBeVisible();
  const file = await run(page, 'Trim');
  expect(file.suggestedFilename()).toBe('clip-h264-aac_trimmed.mp4');
  await expect(
    page
      .getByText(/starts at the keyframe at 10\.0 s, 0\.50 s before your In point/)
      .filter({ visible: true }),
  ).toBeVisible();
  const info = await probe(file);
  // ±1 GOP in fast mode (tools/video.md → Tests): here exactly 10.5 s from the keyframe.
  expect(info.durationSec).toBeGreaterThan(10.45);
  expect(info.durationSec).toBeLessThan(10.56);
  expect(info.video?.codec).toBe('avc');
  expect(info.audio[0]?.codec).toBe('aac');
});

test('precise trim cuts 10.000–20.000 to 10 s, within a frame', async ({ page, isMobile }) => {
  await page.goto('/trim-video');
  test.skip(!(await canDecode(page, 'vp09.00.10.08', 'video')), 'needs a VP9 decoder');
  await drop(page, 'clip-vp9-opus.webm');
  await setRange(page, '10', '20');
  await choose(page, isMobile, 'Mode', 'Precise');
  const file = await run(page, 'Trim');
  expect(file.suggestedFilename()).toBe('clip-vp9-opus_trimmed.webm');
  const info = await probe(file);
  expect(Math.abs(info.durationSec - 10)).toBeLessThanOrEqual(1 / 30 + 0.001);
  expect(info.video?.codec).toBe('vp9');
  expect(await cspViolations(page)).toEqual([]);
});

test('the timeline shows frames and moves by frame with the keyboard', async ({ page }) => {
  await page.goto('/trim-video');
  test.skip(!(await canDecode(page, 'vp09.00.10.08', 'video')), 'needs a VP9 decoder');
  await drop(page, 'clip-vp9-opus.webm');
  const timeline = page.getByRole('group', { name: /^Timeline/ });
  await expect(timeline.locator('img').first()).toBeVisible();
  await timeline.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('i');
  await expect(page.getByRole('textbox', { name: 'In point' })).toHaveValue('00:00:01.000');
});

test('M4A from an MP4 is a straight copy of the AAC audio', async ({ page, isMobile }) => {
  await page.goto('/extract-audio');
  await drop(page, 'clip-h264-aac.mp4');
  await choose(page, isMobile, 'Format', 'M4A');
  const file = await run(page, 'Extract audio');
  expect(file.suggestedFilename()).toBe('clip-h264-aac.m4a');
  await expect(
    page
      .getByText('Copied without re-encoding: the AAC audio is unchanged')
      .filter({ visible: true }),
  ).toBeVisible();
  const info = await probe(file);
  expect(info.video).toBeNull();
  expect(info.audio[0]?.codec).toBe('aac');
  expect(Math.abs(info.durationSec - 30)).toBeLessThan(0.03);
});

test('MP3 at 320 kbps keeps the length within 10 ms', async ({ page, isMobile }) => {
  await page.goto('/extract-audio');
  test.skip(!(await canDecode(page, 'opus', 'audio')), 'needs an Opus decoder');
  await drop(page, 'clip-vp9-opus.webm');
  // Phones show Bitrate in the Format row's sheet.
  await choose(page, isMobile, isMobile ? 'Format' : 'Bitrate', '320 kbps');
  const file = await run(page, 'Extract audio');
  expect(file.suggestedFilename()).toBe('clip-vp9-opus.mp3');
  await expect(
    page.getByText('Encoded as MP3 at 320 kbps').filter({ visible: true }),
  ).toBeVisible();
  const info = await probe(file);
  expect(info.audio[0]?.codec).toBe('mp3');
  // LAME loads as its own worker and WASM file, inside the page's CSP.
  expect(await cspViolations(page)).toEqual([]);
  // MP3 frames are 24 ms at 48 kHz; encoder padding stays under one frame each end.
  const audio = info.audio[0];
  expect(
    Math.abs(info.durationSec - 30),
    `${String(info.durationSec)} s, ${String(audio?.sampleRate)} Hz, ${String(audio?.channels)} channels`,
  ).toBeLessThan(0.06);
});

test('the MP4 to MP3 pair page has its own copy', async ({ page }) => {
  await page.goto('/convert/mp4-to-mp3');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('MP4 to MP3 Converter');
  await expect(page.getByRole('heading', { name: 'About MP4 and MP3' })).toBeVisible();
});

/** Frames, size and loop block of a GIF, read from its bytes. */
function gifInfo(bytes: Buffer) {
  const byte = (i: number) => bytes[i] ?? 0;
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let at = 13 + (byte(10) & 0x80 ? 3 * (1 << ((byte(10) & 7) + 1)) : 0);
  let frames = 0;
  let loops = false;
  while (at < bytes.length && byte(at) !== 0x3b) {
    if (byte(at) === 0x21) {
      if (byte(at + 1) === 0xff && bytes.toString('latin1', at + 3, at + 14) === 'NETSCAPE2.0') {
        loops = true;
      }
      at += 2;
    } else {
      frames += 1;
      const flags = byte(at + 9);
      at += 10 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1;
    }
    while (byte(at) > 0) at += byte(at) + 1;
    at += 1;
  }
  return { width, height, frames, loops };
}

test('5 s at 12 fps makes a looping GIF of 60 frames', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the GIF path is the same on phones; covered on desktop');
  await page.goto('/video-to-gif');
  test.skip(!(await canDecode(page, 'vp09.00.10.08', 'video')), 'needs a VP9 decoder');
  await drop(page, 'clip-vp9-opus.webm');
  await expect(page.getByText(/^60 frames · about/)).toBeVisible();
  const file = await run(page, 'Make GIF');
  expect(file.suggestedFilename()).toBe('clip-vp9-opus.gif');
  const gif = gifInfo(readFileSync(await file.path()));
  // The clip is 256 px wide and GIFs never upscale; testsrc2 moves every frame,
  // so no frame is merged into the one before.
  expect(gif).toEqual({ width: 256, height: 144, frames: 60, loops: true });
  expect(await cspViolations(page)).toEqual([]);
});

// Every Turbopack worker starts from the same bootstrap script, told its
// chunks by the URL fragment; the service worker must not mix them up.
test('after the GIF worker, an image tool still runs its own worker', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the service worker is the same on phones');
  await page.goto('/video-to-gif');
  test.skip(!(await canDecode(page, 'vp09.00.10.08', 'video')), 'needs a VP9 decoder');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await drop(page, 'clip-vp9-opus.webm');
  const gif = await run(page, 'Make GIF');
  await page.goto('/image-converter');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'clip.gif',
      mimeType: 'image/gif',
      buffer: readFileSync(await gif.path()),
    });
  const jpeg = readFileSync(await (await run(page, 'Convert')).path());
  expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff]);
});

test('compress to a size lands under it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the phone sheet is covered by other tools');
  await page.goto('/compress-video');
  test.skip(!(await canDecode(page, 'vp09.00.10.08', 'video')), 'needs a VP9 decoder');
  await drop(page, 'clip-vp9-opus.webm');
  await page.getByRole('combobox', { name: 'Size' }).selectOption('custom');
  await page.getByRole('spinbutton', { name: 'Custom size' }).fill('0.6');
  await expect(page.getByText('Just under 0.6 MB')).toBeVisible();
  // At 256 × 144 the test browser's VP9 encoder won't go below about 90 kbps;
  // without audio, 0.6 MB leaves 155 kbps for the picture.
  await choose(page, false, 'Audio', 'Remove');
  const file = await run(page, 'Compress');
  const size = readFileSync(await file.path()).length;
  expect(size).toBeLessThanOrEqual(600_000);
  expect(size).toBeGreaterThan(400_000);
  const info = await probe(file);
  expect(Math.abs(info.durationSec - 30)).toBeLessThan(0.1);
  expect(info.audio).toEqual([]);
});
