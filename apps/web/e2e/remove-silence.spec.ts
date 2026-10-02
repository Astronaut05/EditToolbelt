import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, pick, test } from './fixtures';

// A11 Remove Silence (tools/audio.md → Tests): known pauses are found within ±20 ms.

const RATE = 48_000;
const LENGTH = 10;
/** The fixture's pauses, seconds: faint noise between stretches of tone. The last is under 0.5 s. */
const PAUSES = [
  { start: 2.013, end: 3.027 },
  { start: 5.004, end: 5.811 },
  { start: 8, end: 8.3 },
];

/** 10 s of a 220 Hz tone at −9 dBFS with three pauses of noise at about −59 dBFS, as a 16-bit WAV. */
function speechWav(): Buffer {
  const frames = RATE * LENGTH;
  const out = Buffer.alloc(44 + frames * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + frames * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * 2, 40);
  let seed = 1;
  const noise = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return (seed / 2_147_483_647) * 2 - 1;
  };
  for (let i = 0; i < frames; i += 1) {
    const t = i / RATE;
    const quiet = PAUSES.some((p) => t >= p.start && t < p.end);
    const v = quiet ? noise() * 0.002 : 0.5 * Math.sin(2 * Math.PI * 220 * t);
    out.writeInt16LE(Math.round(v * 32_767), 44 + i * 2);
  }
  return out;
}

/** Frames in a WAV's data chunk. */
function wavFrames(bytes: Buffer): number {
  const channels = bytes.readUInt16LE(22);
  const bits = bytes.readUInt16LE(34);
  const dataAt = bytes.indexOf('data', 12);
  return bytes.readUInt32LE(dataAt + 4) / (channels * (bits / 8));
}

async function open(page: Page) {
  await page.goto('/remove-silence');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'speech.wav', mimeType: 'audio/wav', buffer: speechWav() });
  await expect(
    page.getByText('PCM 16-bit · 48 kHz · mono · 0:10').filter({ visible: true }),
  ).toBeVisible();
}

/** The timeline's ranges, from their labels ("Range 1: 00:02.113 to 00:02.927"), in seconds. */
async function ranges(page: Page, count: number) {
  const buttons = page.getByRole('group', { name: 'Ranges' }).getByRole('button', {
    name: /^Range \d+:/,
  });
  await expect(buttons).toHaveCount(count);
  const labels = await buttons.evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')));
  const seconds = (tc: string) => {
    const [m, s] = tc.split(':');
    return Number(m) * 60 + Number(s);
  };
  return labels.map((label) => {
    const [, start = '', end = ''] = /: (\S+) to (\S+)$/.exec(label ?? '') ?? [];
    return { start: seconds(start), end: seconds(end) };
  });
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Remove silences', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await button.click();
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

test('finds the two long pauses within 20 ms and cuts them, leaving 0.1 s beside the sound', async ({
  page,
}) => {
  await open(page);
  // Auto threshold, 0.5 s at least: the 0.3 s pause stays.
  const found = await ranges(page, 2);
  found.forEach((cut, i) => {
    const pause = PAUSES[i];
    expect(Math.abs(cut.start - ((pause?.start ?? 0) + 0.1))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(cut.end - ((pause?.end ?? 0) - 0.1))).toBeLessThanOrEqual(0.02);
  });
  const total = found.reduce((sum, c) => sum + (c.end - c.start), 0);
  const out = await run(page);
  expect(out.name).toBe('speech_trimmed.wav');
  // Shorter by exactly what was cut, to the millisecond the labels show.
  expect(Math.abs(wavFrames(out.bytes) - (LENGTH - total) * RATE)).toBeLessThanOrEqual(RATE / 500);
  await expect(
    page.getByText(/^2 silences cut, 1\.\d\d s in all$/).filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('shortens every pause from 0.2 s up, and exports the cut list as CSV', async ({
  page,
  isMobile,
}) => {
  await open(page);
  await ranges(page, 2);
  await setNumber(page, isMobile, 'Silence below', 'At least', '0.2');
  await choose(page, isMobile, 'Silences', 'Shorten');
  await setNumber(page, isMobile, 'Silences', 'Shorten to', '0.1');
  // Found again with the new settings: all three, each shortened to 0.1 s. Each change
  // searches again, so the ranges are read until the last search has landed.
  let found: { start: number; end: number }[] = [];
  await expect(async () => {
    found = await ranges(page, 3);
    found.forEach((cut, i) => {
      const pause = PAUSES[i];
      expect(Math.abs(cut.start - ((pause?.start ?? 0) + 0.05))).toBeLessThanOrEqual(0.02);
      expect(Math.abs(cut.end - ((pause?.end ?? 0) - 0.05))).toBeLessThanOrEqual(0.02);
    });
  }).toPass({ timeout: 15_000 });
  await choose(page, isMobile, 'Export', 'Cut list (CSV)');
  const out = await run(page);
  expect(out.name).toBe('speech_cuts.csv');
  const rows = out.bytes.toString('utf8').trim().split('\n');
  expect(rows[0]).toBe('cut,start,end,length_s,start_s,end_s');
  expect(rows).toHaveLength(4);
  rows.slice(1).forEach((row, i) => {
    const [n, start, end, , startS, endS] = row.split(',');
    expect(n).toBe(String(i + 1));
    expect(start).toMatch(/^00:00:\d\d\.\d{3}$/);
    expect(end).toMatch(/^00:00:\d\d\.\d{3}$/);
    expect(Math.abs(Number(startS) - (found[i]?.start ?? 0))).toBeLessThanOrEqual(0.001);
    expect(Math.abs(Number(endS) - (found[i]?.end ?? 0))).toBeLessThanOrEqual(0.001);
  });
});

test('says so when nothing is quiet enough, and waits', async ({ page, isMobile }) => {
  await open(page);
  await ranges(page, 2);
  // The pauses' noise is about −59 dBFS: above a −60 dBFS threshold.
  await pick(page, isMobile, 'Silence below', '-60');
  await expect(
    page.getByText(/^No silences found with these settings/).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove silences', exact: true })).toBeDisabled();
});
