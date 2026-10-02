import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, videoPackets } from '@etb/engines';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// V14 Add or Replace Audio in Video (tools/video.md → Tests): the output is
// as long as the video, the picture is copied, and the levels are as set
// (±1 dB). The sound is decoded in the page to measure it.

const CLIP = fileURLToPath(new URL('../../../fixtures/video/clip-vp9-opus.webm', import.meta.url));

/** 10 s of a 330 Hz tone at amplitude 0.5 (−9.03 dBFS RMS), 44.1 kHz stereo: a different rate from the video's 48 kHz. */
function musicWav(): Buffer {
  const rate = 44_100;
  const frames = rate * 10;
  const out = Buffer.alloc(44 + frames * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + frames * 4, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const v = Math.round(0.5 * Math.sin((2 * Math.PI * 330 * i) / rate) * 32_767);
    out.writeInt16LE(v, 44 + i * 4);
    out.writeInt16LE(v, 46 + i * 4);
  }
  return out;
}
const MUSIC_DB = 20 * Math.log10(0.5 / Math.SQRT2);

async function open(page: Page, isMobile: boolean) {
  await page.goto('/replace-audio');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(CLIP);
  await expect(
    page
      .getByText(/256 × 144/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  // Not before the music is in.
  await expect(page.getByRole('button', { name: 'Add the sound', exact: true })).toBeDisabled();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Music or sound/ }).click();
  await (isMobile ? sheet : page.getByRole('region', { name: 'Settings' }))
    .locator('input[type=file][aria-label="Music or sound"]')
    .setInputFiles({ name: 'music.wav', mimeType: 'audio/wav', buffer: musicWav() });
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  await expect(page.getByText('music.wav').filter({ visible: true }).first()).toBeVisible();
}

/** A dropdown in a phone settings row headed by another option. */
async function pickIn(page: Page, isMobile: boolean, row: string, label: string, value: string) {
  if (!isMobile) {
    await page.getByRole('combobox', { name: label }).selectOption(value);
    return;
  }
  await page.getByRole('button', { name: new RegExp(`^${row}`) }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await sheet.getByRole('combobox', { name: label }).selectOption(value);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Add the sound', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** RMS in dBFS of the first channel over each [from, to) window, decoded by the page. */
async function levels(page: Page, bytes: Buffer, windows: [number, number][]) {
  return page.evaluate(
    async ({ data, windows }) => {
      const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(raw.buffer);
      const samples = audio.getChannelData(0);
      return windows.map(([from, to]) => {
        let sum = 0;
        const a = Math.round(from * audio.sampleRate);
        const b = Math.round(to * audio.sampleRate);
        for (let i = a; i < b; i += 1) sum += (samples[i] ?? 0) ** 2;
        return 10 * Math.log10(sum / (b - a));
      });
    },
    { data: bytes.toString('base64'), windows },
  );
}

test('replaces the sound with music at −6 dB, looped to the video’s 30 s, the picture copied', async ({
  page,
  isMobile,
}) => {
  await open(page, isMobile);
  await pickIn(page, isMobile, 'Music level', 'Music level', '-6');
  await pickIn(page, isMobile, 'Fade in', 'Fade out', '0');
  const out = await run(page);
  expect(out.name).toBe('clip-vp9-opus_with-sound.webm');
  const source = readFileSync(CLIP);
  const info = await probeMedia(new Blob([out.bytes]));
  const own = await probeMedia(new Blob([source]));
  expect(Math.abs(info.durationSec - own.durationSec)).toBeLessThan(0.05);
  expect(info.audio.map((a) => [a.codec, a.sampleRate, a.channels])).toEqual([['opus', 48_000, 2]]);
  // Every video packet is the source's, byte for byte.
  const before = await videoPackets(new Blob([source]));
  const after = await videoPackets(new Blob([out.bytes]));
  expect(after.length).toBe(before.length);
  expect(after.every((p, i) => Buffer.from(p).equals(Buffer.from(before[i] ?? [])))).toBe(true);
  // The music's level less 6 dB, in the first pass and in a repeat.
  const [first, repeat] = await levels(page, out.bytes, [
    [2, 8],
    [12, 18],
  ]);
  expect(Math.abs((first ?? 0) - (MUSIC_DB - 6))).toBeLessThan(1);
  expect(Math.abs((repeat ?? 0) - (MUSIC_DB - 6))).toBeLessThan(1);
  await expect(
    page.getByText('The music loops 2 times to fill 30.0 s').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('mixes the music under the video’s own sound, once, then the sound carries on', async ({
  page,
  isMobile,
}) => {
  await open(page, isMobile);
  await choose(page, isMobile, 'Music or sound', 'Keep it, music under');
  // On phones, in the row headed by the start point.
  await choose(page, isMobile, 'Start the music at', 'Play it once');
  const out = await run(page);
  const own = await levels(page, readFileSync(CLIP), [
    [2, 7],
    [15, 25],
  ]);
  const mixed = await levels(page, out.bytes, [
    [2, 7],
    [15, 25],
  ]);
  // Music at −15 dB on top of the video's sound at 0 dB: their powers add.
  const music = MUSIC_DB - 15;
  const expected = 10 * Math.log10(10 ** ((own[0] ?? 0) / 10) + 10 ** (music / 10));
  expect(Math.abs((mixed[0] ?? 0) - expected)).toBeLessThan(1);
  // After the music ends, the video's own sound as it was.
  expect(Math.abs((mixed[1] ?? 0) - (own[1] ?? 0))).toBeLessThan(1);
  await expect(
    page
      .getByText('The music ends at 10.0 s; the video’s own sound carries on')
      .filter({ visible: true }),
  ).toBeVisible();
});
