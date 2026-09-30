import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoFrameTimes, videoPackets } from '@etb/engines';
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

/** A hash of every video packet, in order: equal lists mean the frames were copied. */
async function videoPacketHashes(file: Blob): Promise<string[]> {
  const bytes = await videoPackets(file);
  return bytes.map((b) => createHash('sha256').update(b).digest('hex'));
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

// V07 Mute Video (tools/video.md → Tests).

test('mute removes the audio and copies the picture', async ({ page }) => {
  await page.goto('/mute-video');
  await drop(page, 'clip-h264-aac.mp4');
  const file = await run(page, 'Mute');
  expect(file.suggestedFilename()).toBe('clip-h264-aac_muted.mp4');
  const info = await probe(file);
  expect(info.audio).toEqual([]);
  expect(info.video).toMatchObject({ codec: 'avc', width: 256, height: 144 });
  await expect(page.getByText(/the picture is copied, not re-encoded/).first()).toBeAttached();
});

test('muting the selection silences only that part', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the timeline is covered on phones by Trim');
  await page.goto('/mute-video');
  test.skip(!(await canDecode(page, 'opus', 'audio')), 'needs an Opus decoder');
  await drop(page, 'clip-vp9-opus.webm');
  await choose(page, false, 'Mute', 'The selection');
  await setRange(page, '10', '20');
  const file = await run(page, 'Mute');
  const bytes = readFileSync(await file.path()).toString('base64');
  // Loudness inside the muted range and on either side of it, decoded in the page.
  const rms = await page.evaluate(async (data) => {
    const buffer = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer;
    const audio = await new AudioContext().decodeAudioData(buffer);
    const level = (from: number, to: number) => {
      const samples = audio
        .getChannelData(0)
        .subarray(from * audio.sampleRate, to * audio.sampleRate);
      let sum = 0;
      for (const s of samples) sum += s * s;
      return Math.sqrt(sum / samples.length);
    };
    return { before: level(2, 9), inside: level(11, 19), after: level(21, 28) };
  }, bytes);
  expect(rms.inside).toBeLessThan(0.001);
  expect(rms.before).toBeGreaterThan(0.01);
  expect(rms.after).toBeGreaterThan(0.01);
});

// V08 Video Info & VFR Check (tools/video.md → Tests).

test('video info flags variable frame rate, and not a constant one', async ({ page }) => {
  await page.goto('/video-info');
  await drop(page, 'clip-vfr.mp4');
  await expect(page.getByText(/^Variable frame rate \(about 28/).first()).toBeAttached();
  const report = page.getByRole('region', { name: 'Workspace' }).getByLabel('Full report');
  await expect(report).toContainText(/Frame rate\s+28\.\d+ fps, variable/);
  await page.getByRole('button', { name: 'Start over' }).first().click();
  await drop(page, 'clip-h264-aac.mp4');
  await expect(
    page.getByText('Constant frame rate, SDR, no rotation: ready to edit.').first(),
  ).toBeAttached();
  await expect(report).toContainText(/Frame rate\s+30 fps, constant/);
});

test('video info reports HDR and exports JSON', async ({ page, isMobile }) => {
  await page.goto('/video-info');
  await drop(page, 'clip-hlg.mp4');
  await expect(page.getByText(/^HDR \(HLG\): it will look washed out/).first()).toBeAttached();
  await choose(page, isMobile, 'Export as', 'JSON');
  const button = page.getByRole('button', { name: /^Download JSON/ }).first();
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('clip-hlg_info.json');
  const json = JSON.parse(readFileSync(await file.path(), 'utf8')) as {
    video: { transfer: string; hdr: string };
  };
  expect(json.video).toMatchObject({ transfer: 'hlg', hdr: 'HLG' });
});

// V05 GIF to MP4 (tools/video.md → Tests): frame timing preserved.

/**
 * The length players show: MP4's from its sample table (the probe reads it),
 * WebM's from the Segment Duration in its header (in ms; Mediabunny's reader
 * adds up blocks instead, and a WebM block carries no duration).
 */
async function playedSeconds(bytes: Buffer<ArrayBuffer>, ext: string): Promise<number> {
  if (ext === 'mp4') return (await probeMedia(new Blob([bytes]))).durationSec;
  const at = bytes.indexOf(Buffer.from([0x44, 0x89]));
  const size = (bytes[at + 2] ?? 0) & 0x7f;
  return (size === 8 ? bytes.readDoubleBE(at + 3) : bytes.readFloatBE(at + 3)) / 1000;
}
test('GIF to MP4 keeps each frame’s own delay', async ({ page }) => {
  await page.goto('/gif-to-mp4');
  await drop(page, 'anim-delays.gif');
  await expect(
    page.getByText('64 × 48 px · 6 frames · 0.60 s').filter({ visible: true }),
  ).toBeVisible();
  const file = await run(page, 'Convert');
  // H.264 where the browser encodes it (Playwright's Chromium doesn't), else VP9 in WebM.
  expect(file.suggestedFilename()).toMatch(/^anim-delays\.(mp4|webm)$/);
  const bytes = readFileSync(await file.path());
  const times = await videoFrameTimes(new Blob([bytes]));
  // 30, 70, 0 (played at 100), 250, 40 and 110 ms.
  expect(times.map((t) => Math.round(t * 1000))).toEqual([0, 30, 100, 200, 450, 490]);
  const ext = file.suggestedFilename().split('.').pop() ?? '';
  expect(await playedSeconds(bytes, ext)).toBeCloseTo(0.6, 2);
  await expect(
    page.getByText('Transparent areas filled with #ffffff').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

// V03 Video Converter (tools/video.md → Tests).

test('MOV (H.264) → MP4 is a remux, frame for frame', async ({ page }) => {
  await page.goto('/video-converter');
  await drop(page, 'clip-h264-aac.mov');
  const file = await run(page, 'Convert');
  expect(file.suggestedFilename()).toBe('clip-h264-aac.mp4');
  await expect(
    page
      .getByText('Remuxed: the tracks fit the new format as they are, so nothing was re-encoded')
      .filter({ visible: true }),
  ).toBeVisible();
  const out = new Blob([readFileSync(await file.path())]);
  const source = new Blob([readFileSync(fixture('clip-h264-aac.mov'))]);
  expect(await videoPacketHashes(out)).toEqual(await videoPacketHashes(source));
  expect(await cspViolations(page)).toEqual([]);
});

test('MKV (VP9) → MP4 re-encodes to H.264', async ({ page }) => {
  await page.goto('/video-converter');
  test.skip(!(await canDecode(page, 'vp09.00.10.08', 'video')), 'needs a VP9 decoder');
  // The engine asks for High-profile H.264 (Mediabunny's codec string).
  // OpenH264, which Chromium and Firefox use on Linux, encodes only Baseline,
  // so there the file is WebM, with a note.
  const h264 = await page.evaluate(
    async () =>
      (
        await VideoEncoder.isConfigSupported({
          codec: 'avc1.64001f',
          width: 256,
          height: 144,
        })
      ).supported === true,
  );
  await drop(page, 'clip-vp9-opus.mkv');
  const file = await run(page, 'Convert');
  const info = await probeMedia(new Blob([readFileSync(await file.path())]));
  if (h264) {
    expect(file.suggestedFilename()).toBe('clip-vp9-opus.mp4');
    expect(info.video?.codec).toBe('avc');
  } else {
    // No High-profile H.264 encoder here: WebM, where the VP9 fits as it is.
    expect(file.suggestedFilename()).toBe('clip-vp9-opus.webm');
    expect(info.video?.codec).toBe('vp9');
    await expect(page.getByText(/^Saved as WebM/).filter({ visible: true })).toBeVisible();
  }
  expect(Math.abs(info.durationSec - 4)).toBeLessThan(0.1);
});
