import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, setRange, test } from './fixtures';

// A15 Reverse Audio (tools/audio.md): the whole file, frame for frame, across
// the ten-second windows it is read in; a selection only, the rest untouched;
// and a lossy format (MP3), decoded again by the page.

const RATE = 48_000;
/** One LSB of 16-bit audio, twice: the float round trip may round either way. */
const TOLERANCE = 2 / 32_767;

/** A 16-bit PCM WAV of planar channels (-1 to 1). */
function wav(planes: Float32Array[]): Buffer {
  const channels = planes.length;
  const frames = planes[0]?.length ?? 0;
  const bytes = frames * channels * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      out.writeInt16LE(Math.round((planes[c]?.[i] ?? 0) * 32_767), 44 + (i * channels + c) * 2);
    }
  }
  return out;
}

/** A 16-bit WAV's channels, back as numbers from -1 to 1. */
function readWav(bytes: Buffer): Float32Array[] {
  const channels = bytes.readUInt16LE(22);
  const dataAt = bytes.indexOf('data', 12);
  const length = bytes.readUInt32LE(dataAt + 4);
  const frames = length / (channels * 2);
  const planes = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const plane = planes[c];
      if (plane) plane[i] = bytes.readInt16LE(dataAt + 8 + (i * channels + c) * 2) / 32_767;
    }
  }
  return planes;
}

/** A sawtooth 1,000 frames long: every frame differs from its neighbours by 26 LSB, so a shift of one shows. */
const saw = (seconds: number, phase = 0) =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => (((i + phase) % 1000) / 1000 - 0.5) * 0.8,
  );

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

async function open(page: Page, name: string, buffer: Buffer, summary: RegExp) {
  await page.goto('/reverse-audio');
  await fileInput(page).setInputFiles({ name, mimeType: 'audio/wav', buffer });
  await expect(page.getByText(summary).filter({ visible: true })).toBeVisible();
}

async function reverse(page: Page) {
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** The first frame where `got` isn't `want` within the tolerance, or -1. */
function firstDifference(
  got: Float32Array,
  want: (i: number) => number,
  from = 0,
  to = got.length,
) {
  for (let i = from; i < to; i += 1) {
    if (Math.abs((got[i] ?? 99) - want(i)) > TOLERANCE) return i;
  }
  return -1;
}

test('a 25 s WAV comes out backwards, frame for frame, across its windows', async ({ page }) => {
  const input = saw(25);
  await open(page, 'saw.wav', wav([input]), /PCM 16-bit · 48 kHz · mono · 0:25/);
  const out = await reverse(page);
  expect(out.name).toBe('saw_reversed.wav');
  const [got] = readWav(out.bytes);
  if (!got) throw new Error('no audio');
  expect(got.length).toBe(input.length);
  const n = input.length;
  expect(firstDifference(got, (i) => input[n - 1 - i] ?? 0)).toBe(-1);
  await expect(
    page.getByText('Reversed the whole file: 25.00 s').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('a selection is reversed and the rest is left as it was', async ({ page, isMobile }) => {
  const left = saw(3);
  const right = saw(3, 500);
  await open(page, 'two.wav', wav([left, right]), /PCM 16-bit · 48 kHz · stereo · 0:03/);
  await setRange(page, '1', '2');
  const out = await reverse(page);
  const [l, r] = readWav(out.bytes);
  if (!l || !r) throw new Error('no audio');
  expect(l.length).toBe(left.length);
  const [a, b] = [RATE, 2 * RATE];
  const fade = 240;
  // Each side before and after, untouched (beyond the 5 ms dip at each join).
  expect(firstDifference(l, (i) => left[i] ?? 0, 0, a - fade)).toBe(-1);
  expect(firstDifference(r, (i) => right[i] ?? 0, b + fade, r.length)).toBe(-1);
  // The selection, back to front, in both channels.
  expect(firstDifference(l, (i) => left[a + b - 1 - i] ?? 0, a + fade, b - fade)).toBe(-1);
  expect(firstDifference(r, (i) => right[a + b - 1 - i] ?? 0, a + fade, b - fade)).toBe(-1);
  // Silent right at the joins, so they don't click.
  expect(Math.abs(l[a] ?? 1)).toBeLessThan(0.01);
  expect(Math.abs(l[b - 1] ?? 1)).toBeLessThan(0.01);
  await expect(
    page.getByText('Reversed 0:01.000–0:02.000, the rest as it was').filter({ visible: true }),
  ).toBeVisible();
  // The format choice is there on every screen.
  await choose(page, isMobile, 'Format', 'FLAC');
});

test('an MP3 reversed has its sound at the other end', async ({ page, isMobile }) => {
  // A loud half second, then 2.5 s of near silence.
  const burst = Float32Array.from({ length: 3 * RATE }, (_, i) =>
    i < RATE / 2 ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE) : 0,
  );
  await open(page, 'burst.wav', wav([burst]), /PCM 16-bit · 48 kHz · mono · 0:03/);
  // MP3: the test browsers have no AAC encoder for M4A.
  await choose(page, isMobile, 'Format', 'MP3');
  const out = await reverse(page);
  expect(out.name).toBe('burst_reversed.mp3');
  const [head, tail] = await page.evaluate(async (data) => {
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(raw.buffer);
    const samples = audio.getChannelData(0);
    const rms = (from: number, to: number) => {
      let sum = 0;
      const a = Math.round(from * audio.sampleRate);
      const b = Math.round(to * audio.sampleRate);
      for (let i = a; i < b; i += 1) sum += (samples[i] ?? 0) ** 2;
      return Math.sqrt(sum / (b - a));
    };
    return [rms(0.2, 2.2), rms(audio.duration - 0.4, audio.duration - 0.1)];
  }, out.bytes.toString('base64'));
  expect(head).toBeLessThan(0.01);
  expect(tail).toBeGreaterThan(0.2);
});
