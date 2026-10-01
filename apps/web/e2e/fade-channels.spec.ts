import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, expect, pick, test } from './fixtures';

// A07 Fade In / Fade Out and A13 Audio Channel Tools (tools/audio.md → Tests):
// the gain at a fade's midpoint matches the curve's formula, and an L-only
// file with "copy L to both" comes out with identical channels.

const RATE = 48_000;

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

const constant = (seconds: number, value: number) =>
  new Float32Array(Math.round(seconds * RATE)).fill(value);

const tone = (seconds: number, a = 0.4, hz = 440) =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => a * Math.sin((2 * Math.PI * hz * i) / RATE),
  );

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

async function run(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** Sets a number setting: in place on desktop, in its settings sheet on phones. */
async function setNumber(page: Page, isMobile: boolean, row: string, label: string, value: string) {
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: new RegExp(`^${row}`) }).click();
  await (isMobile ? sheet : page).getByRole('spinbutton', { name: label }).fill(value);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
}

test('the gain halfway through each fade matches its curve', async ({ page, isMobile }) => {
  await page.goto('/fade-audio');
  // A steady level, so the gain can be read off each sample.
  await fileInput(page).setInputFiles({
    name: 'level.wav',
    mimeType: 'audio/wav',
    buffer: wav([constant(10, 0.5)]),
  });
  await setNumber(page, isMobile, 'Fade in', 'Fade in', '2');
  await pick(page, isMobile, 'Fade in', 'exponential');
  await setNumber(page, isMobile, 'Fade out', 'Fade out', '4');
  await pick(page, isMobile, 'Fade out', 's-curve');
  const out = await run(page, 'Add fades');
  expect(out.name).toBe('level_faded.wav');
  const [plane] = readWav(out.bytes);
  if (!plane) throw new Error('no audio');
  expect(plane.length).toBe(10 * RATE);
  const gain = (seconds: number) => (plane[Math.round(seconds * RATE)] ?? 0) / 0.5;
  // Exponential halfway: (e^2 - 1) / (e^4 - 1) = 0.119. S-curve halfway: 0.5.
  expect(gain(1)).toBeCloseTo((Math.exp(2) - 1) / (Math.exp(4) - 1), 2);
  expect(gain(8)).toBeCloseTo(0.5, 2);
  expect(gain(4)).toBeCloseTo(1, 3);
  expect(Math.abs(gain(0))).toBeLessThan(0.01);
  expect(Math.abs(gain(9.9999))).toBeLessThan(0.01);
});

test('a lav on the left only: the fix is picked, and both sides come out the same', async ({
  page,
}) => {
  await page.goto('/audio-channels');
  await fileInput(page).setInputFiles({
    name: 'lav.wav',
    mimeType: 'audio/wav',
    buffer: wav([tone(4), constant(4, 0)]),
  });
  await expect(
    page.getByText('The right channel is silent: it plays in one ear.').first(),
  ).toBeVisible();
  const out = await run(page, 'Apply');
  expect(out.name).toBe('lav_fixed.wav');
  const [l, r] = readWav(out.bytes);
  expect(r).toBeDefined();
  expect(Array.from(r ?? [])).toEqual(Array.from(l ?? []));
  let loudest = 0;
  for (const v of l ?? new Float32Array(0)) loudest = Math.max(loudest, Math.abs(v));
  expect(loudest).toBeGreaterThan(0.39);
});

test('stereo to mono, mixed at half each', async ({ page, isMobile }) => {
  await page.goto('/audio-channels');
  await fileInput(page).setInputFiles({
    name: 'two.wav',
    mimeType: 'audio/wav',
    buffer: wav([tone(3, 0.4, 440), tone(3, 0.4, 660)]),
  });
  await pick(page, isMobile, 'Change', 'mono-sum');
  const out = await run(page, 'Apply');
  expect(out.name).toBe('two_mono.wav');
  const planes = readWav(out.bytes);
  expect(planes).toHaveLength(1);
  const expected = (i: number) =>
    (0.4 * Math.sin((2 * Math.PI * 440 * i) / RATE) +
      0.4 * Math.sin((2 * Math.PI * 660 * i) / RATE)) /
    2;
  for (const i of [100, 12_345, 100_000]) {
    expect(planes[0]?.[i]).toBeCloseTo(expected(i), 3);
  }
});

test('split stereo into two mono files', async ({ page, isMobile }) => {
  await page.goto('/audio-channels');
  await fileInput(page).setInputFiles({
    name: 'two.wav',
    mimeType: 'audio/wav',
    buffer: wav([constant(2, 0.25), constant(2, -0.5)]),
  });
  await pick(page, isMobile, 'Change', 'split');
  const out = await run(page, 'Apply');
  expect(out.name).toBe('two_split.zip');
  // Stored entries: name, then the data.
  const names: string[] = [];
  const files: Buffer[] = [];
  let at = 0;
  while (out.bytes.readUInt32LE(at) === 0x04034b50) {
    const size = out.bytes.readUInt32LE(at + 18);
    const nameLength = out.bytes.readUInt16LE(at + 26);
    const extra = out.bytes.readUInt16LE(at + 28);
    names.push(out.bytes.toString('utf8', at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    files.push(out.bytes.subarray(start, start + size));
    at = start + size;
  }
  expect(names).toEqual(['two_L.wav', 'two_R.wav']);
  const [left] = readWav(files[0] ?? Buffer.alloc(0));
  const [right] = readWav(files[1] ?? Buffer.alloc(0));
  expect(readWav(files[0] ?? Buffer.alloc(0))).toHaveLength(1);
  expect(left?.[1000]).toBeCloseTo(0.25, 3);
  expect(right?.[1000]).toBeCloseTo(-0.5, 3);
  expect(left?.length).toBe(2 * RATE);
});

test('a mono file is offered mono to stereo', async ({ page }) => {
  await page.goto('/audio-channels');
  await fileInput(page).setInputFiles({
    name: 'voice.wav',
    mimeType: 'audio/wav',
    buffer: wav([tone(2)]),
  });
  const out = await run(page, 'Apply');
  expect(out.name).toBe('voice_stereo.wav');
  const [l, r] = readWav(out.bytes);
  expect(Array.from(r ?? [])).toEqual(Array.from(l ?? []));
});

test('a file in one ear is fixed in MP3 too', async ({ page, isMobile }) => {
  await page.goto('/audio-channels');
  await fileInput(page).setInputFiles({
    name: 'lav.wav',
    mimeType: 'audio/wav',
    buffer: wav([constant(3, 0), tone(3)]),
  });
  await expect(
    page.getByText('The left channel is silent: it plays in one ear.').first(),
  ).toBeVisible();
  await choose(page, isMobile, 'Format', 'MP3');
  const out = await run(page, 'Apply');
  expect(out.name).toBe('lav_fixed.mp3');
  expect(out.bytes.length).toBeGreaterThan(10_000);
});
