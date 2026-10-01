import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, pick, test } from './fixtures';

// A06 Loudness Meter and A05 Normalize Loudness (tools/audio.md → Tests): the
// meter reads the EBU's reference tone right, and normalized audio, measured
// again by the meter, is within 0.5 LU of the target with its true peak under
// the ceiling.

const RATE = 48_000;

/** A 16-bit PCM WAV of planar channels (-1 to 1). */
function wav(planes: Float32Array[], rate = RATE): Buffer {
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
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const v = Math.max(-1, Math.min(1, planes[c]?.[i] ?? 0));
      out.writeInt16LE(Math.round(v * 32_767), 44 + (i * channels + c) * 2);
    }
  }
  return out;
}

/** A sine at `db` dBFS peak. */
function sine(seconds: number, db: number, hz = 1000): Float32Array {
  const a = 10 ** (db / 20);
  return Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => a * Math.sin((2 * Math.PI * hz * i) / RATE),
  );
}

/** A -20 dBFS tone with a 2 ms burst near full scale every half second: it needs the limiter. */
function peaky(seconds: number): Float32Array {
  const plane = sine(seconds, -20, 440);
  let seed = 5;
  for (let start = RATE / 4; start < plane.length; start += RATE / 2) {
    for (let i = 0; i < RATE / 500; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      plane[start + i] = 0.9 * ((seed / 4294967296) * 2 - 1);
    }
  }
  return plane;
}

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

/** An analyzer fact: its number, without the unit. */
async function fact(page: Page, label: string): Promise<number> {
  const value = page
    .locator('main dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')
    .first();
  await expect(value).toBeVisible({ timeout: 60_000 });
  const text = (await value.innerText()).replace('−', '-');
  return Number.parseFloat(text);
}

/** Measures audio with the Loudness Meter page: integrated LUFS and true peak dBTP. */
async function meter(page: Page, name: string, buffer: Buffer, mimeType = 'audio/wav') {
  await page.goto('/loudness-meter');
  await fileInput(page).setInputFiles({ name, mimeType, buffer });
  return { integrated: await fact(page, 'Integrated'), truePeak: await fact(page, 'True peak') };
}

async function normalize(
  page: Page,
  name: string,
  buffer: Buffer,
  configure?: () => Promise<void>,
) {
  await page.goto('/normalize-audio');
  await fileInput(page).setInputFiles({ name, mimeType: 'audio/wav', buffer });
  await configure?.();
  await page.getByRole('button', { name: 'Normalize', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('reads the EBU reference tone: -23 dBFS stereo at 1 kHz is -23.0 LUFS', async ({ page }) => {
  const tone = sine(20, -23);
  const m = await meter(page, 'tone.wav', wav([tone, tone]));
  expect(Math.abs(m.integrated + 23)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(m.truePeak + 23)).toBeLessThanOrEqual(0.1);
  expect(await fact(page, 'Loudness range')).toBeLessThanOrEqual(0.1);
  const main = page.locator('main');
  await expect(
    main.getByText(/EBU R128 broadcast, −23 LUFS: within 0\.5 LU/).first(),
  ).toBeAttached();
  await expect(
    main.getByText(/YouTube, −14 LUFS: 9\.0 LU quieter than the reference/).first(),
  ).toBeAttached();
  await expect(main.getByRole('img', { name: /^Short-term loudness/ })).toBeAttached();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('tone_loudness.txt');
  expect(readFileSync(await file.path(), 'utf8')).toMatch(/Integrated\s+−23\.0 LUFS/);
  expect(await cspViolations(page)).toEqual([]);
});

test('exports the loudness every 100 ms as a CSV', async ({ page, isMobile }) => {
  await page.goto('/loudness-meter');
  const tone = sine(10, -20);
  await fileInput(page).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: wav([tone]),
  });
  await fact(page, 'Integrated');
  await choose(page, isMobile, 'Export', 'Every 100 ms (CSV)');
  const download = page.getByRole('button', { name: /^Download CSV/ }).first();
  await expect(download).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('tone_loudness.csv');
  const lines = readFileSync(await file.path(), 'utf8')
    .trim()
    .split('\n');
  expect(lines[0]).toBe('time_s,momentary_lufs,short_term_lufs');
  // From 0.4 s to 10.0 s, every 100 ms.
  expect(lines.length - 1).toBe(97);
  expect(lines[1]).toMatch(/^0\.4,-2[34]\.\d\d,$/);
  expect(lines.at(-1)).toMatch(/^10\.0,-2[34]\.\d\d,-2[34]\.\d\d$/);
});

test('turns quiet audio up to -14 LUFS with gain alone', async ({ page }) => {
  const tone = sine(10, -30);
  const out = await normalize(page, 'quiet.wav', wav([tone, tone]));
  expect(out.name).toBe('quiet_normalized.wav');
  await expect(page.getByText(/^Raised 16\.\d dB to −14\.0 LUFS$/).first()).toBeAttached();
  const m = await meter(page, 'quiet_normalized.wav', out.bytes);
  expect(Math.abs(m.integrated + 14)).toBeLessThanOrEqual(0.5);
  expect(m.truePeak).toBeLessThanOrEqual(-1);
});

test('limits the peaks to reach -14 LUFS, true peak under -1 dBTP', async ({ page }) => {
  const plane = peaky(20);
  const out = await normalize(page, 'peaky.wav', wav([plane, plane]));
  await expect(
    page.getByText(/^The limiter took up to \d+\.\d dB off the loudest peaks$/).first(),
  ).toBeAttached();
  const m = await meter(page, 'peaky_normalized.wav', out.bytes);
  expect(Math.abs(m.integrated + 14)).toBeLessThanOrEqual(0.5);
  expect(m.truePeak).toBeLessThanOrEqual(-1);
});

test('with gain only, stops where the peaks reach the ceiling', async ({ page, isMobile }) => {
  const plane = peaky(20);
  const out = await normalize(page, 'peaky.wav', wav([plane, plane]), async () => {
    await choose(page, isMobile, 'Mode', 'Gain only');
  });
  await expect(
    page.getByText(/^Stopped at −\d+\.\d LUFS: more gain would push/).first(),
  ).toBeAttached();
  const m = await meter(page, 'peaky_normalized.wav', out.bytes);
  expect(m.integrated).toBeLessThan(-14.5);
  expect(m.truePeak).toBeLessThanOrEqual(-1);
  expect(m.truePeak).toBeGreaterThan(-1.3);
});

test('to EBU R128 as MP3, measured from the encoded file', async ({ page, isMobile }) => {
  const tone = sine(15, -12, 440);
  const out = await normalize(page, 'loud.wav', wav([tone, tone]), async () => {
    await pick(page, isMobile, 'Target', '-23');
    await choose(page, isMobile, 'Format', 'MP3');
  });
  expect(out.name).toBe('loud_normalized.mp3');
  await expect(page.getByText(/measured in the file you download$/).first()).toBeAttached();
  const m = await meter(page, 'loud_normalized.mp3', out.bytes, 'audio/mpeg');
  expect(Math.abs(m.integrated + 23)).toBeLessThanOrEqual(0.5);
});
