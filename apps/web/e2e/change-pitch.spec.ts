import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// A08 Change Speed & Pitch (tools/audio.md → Tests): +2 semitones on a 440 Hz
// tone gives 493.9 Hz ±1 Hz at the same length; tempo 125% gives 0.8 × the
// length.

const RATE = 48_000;

/** 4 s of a 16-bit mono 440 Hz tone at 48 kHz. */
function toneWav(): Buffer {
  const frames = RATE * 4;
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
  for (let i = 0; i < frames; i += 1) {
    out.writeInt16LE(
      Math.round(0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE) * 32_767),
      44 + i * 2,
    );
  }
  return out;
}

/** A 16-bit WAV's frames and its tone's frequency, from zero crossings over the middle. */
function readWav(bytes: Buffer) {
  const channels = bytes.readUInt16LE(22);
  const dataAt = bytes.indexOf('data', 12);
  const frames = bytes.readUInt32LE(dataAt + 4) / (channels * 2);
  const at = (i: number) => bytes.readInt16LE(dataAt + 8 + i * channels * 2);
  const a = Math.floor(frames * 0.2);
  const b = Math.floor(frames * 0.8);
  let crossings = 0;
  for (let i = a + 1; i < b; i += 1) if (at(i - 1) < 0 !== at(i) < 0) crossings += 1;
  return { frames, hz: crossings / 2 / ((b - a) / RATE) };
}

async function open(page: Page) {
  await page.goto('/change-pitch');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(
    page.getByText('PCM 16-bit · 48 kHz · mono · 0:04').filter({ visible: true }),
  ).toBeVisible();
}

/** A setting in the Change row: in place on desktop, in its sheet on phones. */
async function inChangeRow(
  page: Page,
  isMobile: boolean,
  set: (scope: Page | ReturnType<Page['getByRole']>) => Promise<void>,
) {
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Change/ }).click();
  await set(isMobile ? sheet : page);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
}

async function apply(page: Page) {
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), ...readWav(readFileSync(await file.path())) };
}

test('tempo 125% plays in 0.8 × the time at the same pitch', async ({ page, isMobile }) => {
  await open(page);
  // 100% changes nothing, so it waits.
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await inChangeRow(page, isMobile, (scope) =>
    scope.getByRole('spinbutton', { name: 'Speed' }).fill('125'),
  );
  const out = await apply(page);
  expect(out.name).toBe('tone_changed.wav');
  expect(out.frames).toBe(Math.round(4 * RATE * 0.8));
  expect(Math.abs(out.hz - 440)).toBeLessThan(1);
  expect(await cspViolations(page)).toEqual([]);
});

test('+2 semitones moves 440 Hz to 493.9 Hz at the same length', async ({ page, isMobile }) => {
  await open(page);
  await choose(page, isMobile, 'Change', 'Pitch');
  await inChangeRow(page, isMobile, async (scope) => {
    await scope.getByRole('combobox', { name: 'Semitones' }).selectOption('2');
  });
  const out = await apply(page);
  expect(Math.abs(out.frames - 4 * RATE)).toBeLessThanOrEqual(1);
  expect(Math.abs(out.hz - 493.88)).toBeLessThan(1);
});

test('vinyl at 150% is shorter and higher together', async ({ page, isMobile }) => {
  await open(page);
  await choose(page, isMobile, 'Change', 'Both, like vinyl');
  await inChangeRow(page, isMobile, (scope) =>
    scope.getByRole('spinbutton', { name: 'Speed' }).fill('150'),
  );
  const out = await apply(page);
  expect(Math.abs(out.frames - (4 * RATE) / 1.5)).toBeLessThanOrEqual(1);
  expect(Math.abs(out.hz - 660)).toBeLessThan(1);
});
