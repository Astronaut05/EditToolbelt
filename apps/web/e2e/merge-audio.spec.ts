import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// A04 Merge Audio (tools/audio.md → Tests): 3 × 10 s with 1 s crossfades
// make 28 s, and a mix doesn't clip.

/** A 16-bit mono WAV of a sine tone. */
function toneWav(seconds: number, rate: number, hz: number, amp = 0.5): Buffer {
  const frames = Math.round(seconds * rate);
  const out = Buffer.alloc(44 + frames * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + frames * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    out.writeInt16LE(
      Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate) * 32_767),
      44 + i * 2,
    );
  }
  return out;
}

const wav = (name: string, hz: number, rate = 48_000, amp = 0.5) => ({
  name,
  mimeType: 'audio/wav',
  buffer: toneWav(10, rate, hz, amp),
});

/** A 16-bit WAV's rate, channels and first channel as floats. */
function readWav(bytes: Buffer) {
  const channels = bytes.readUInt16LE(22);
  const rate = bytes.readUInt32LE(24);
  const dataAt = bytes.indexOf('data', 12);
  const frames = bytes.readUInt32LE(dataAt + 4) / (channels * 2);
  const first = Float32Array.from(
    { length: frames },
    (_, i) => bytes.readInt16LE(dataAt + 8 + i * channels * 2) / 32_768,
  );
  return { rate, channels, frames, first };
}

/** The tone's frequency in a window, from its zero crossings. */
function hzAt(samples: Float32Array, rate: number, from: number, to: number): number {
  let crossings = 0;
  for (let i = Math.round(from * rate) + 1; i < Math.round(to * rate); i += 1) {
    if ((samples[i - 1] ?? 0) < 0 !== (samples[i] ?? 0) < 0) crossings += 1;
  }
  return crossings / 2 / (to - from);
}

async function drop(page: Page, files: ReturnType<typeof wav>[]) {
  await page.goto('/merge-audio');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(files);
}

async function merged(page: Page) {
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('joins 3 × 10 s with 1 s crossfades into 28 s, in the order set with the keyboard', async ({
  page,
}) => {
  await drop(page, [wav('a.wav', 300), wav('b.wav', 500), wav('c.wav', 700)]);
  const list = page.getByRole('list', { name: 'Files, in order' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByText('PCM 16-bit · 48 kHz · mono · 00:00:10.000').first()).toBeVisible();
  // c up one place, by keyboard: a, c, b. Focus stays on the moved file.
  await page.getByRole('button', { name: 'Move c.wav up' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Move c.wav up' })).toBeFocused();
  await expect(list.getByRole('listitem').nth(1)).toContainText('c.wav');
  const out = await merged(page);
  // The result's player reads only the header until it's played. Loading the
  // whole 28 s result froze WebKit's page (docs/DECISIONS.md, 2026-10-02).
  await expect(page.locator('audio[aria-label="Result"]')).toHaveAttribute('preload', 'metadata');
  expect(out.name).toBe('a_merged.wav');
  const { rate, frames, first } = readWav(out.bytes);
  expect(rate).toBe(48_000);
  expect(frames).toBe(28 * 48_000);
  // a, then c, then b, with the joins at 9–10 s and 18–19 s.
  expect(Math.abs(hzAt(first, rate, 2, 8) - 300)).toBeLessThan(2);
  expect(Math.abs(hzAt(first, rate, 11, 17) - 700)).toBeLessThan(2);
  expect(Math.abs(hzAt(first, rate, 20, 27) - 500)).toBeLessThan(2);
  await expect(
    page.getByText('3 files joined with 1.00 s crossfades: 28.0 s').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('mixes two loud files of different rates without clipping', async ({ page, isMobile }) => {
  await drop(page, [wav('low.wav', 220, 44_100, 0.9), wav('high.wav', 330, 48_000, 0.9)]);
  await choose(page, isMobile, 'Join', 'Mix together');
  const out = await merged(page);
  const { rate, frames, first } = readWav(out.bytes);
  expect(rate).toBe(48_000);
  expect(Math.abs(frames - 10 * 48_000)).toBeLessThanOrEqual(1);
  let peak = 0;
  for (const v of first) peak = Math.max(peak, Math.abs(v));
  // Lowered to −1 dBFS (0.891), not clipped at 1.
  expect(peak).toBeLessThan(0.9);
  expect(peak).toBeGreaterThan(0.85);
  await expect(
    page.getByText(/^Lowered by \d+\.\d dB so the mix peaks at −1 dBFS/).filter({ visible: true }),
  ).toBeVisible();
});

test('waits for a second file, and takes more from Add files', async ({ page }) => {
  await drop(page, [wav('one.wav', 300)]);
  await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled();
  await expect(page.getByText('Add at least 2 files.').filter({ visible: true })).toBeVisible();
  await page
    .locator('input[type=file][aria-label="Add files"]')
    .setInputFiles([wav('two.wav', 500)]);
  await expect(
    page.getByRole('list', { name: 'Files, in order' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove one.wav' }).click();
  await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled();
});
