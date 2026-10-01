import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { cspViolations, expect, pick, setRange, test, unzipStored } from './fixtures';

// A14 Split Audio (tools/audio.md): equal parts that add back up to the file,
// sample for sample; pieces of a length; splits in the middle of silences;
// and a part marked by hand.

const RATE = 48_000;

/** A 16-bit PCM mono WAV (-1 to 1). */
function wav(samples: Float32Array): Buffer {
  const bytes = samples.length * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  samples.forEach((v, i) => out.writeInt16LE(Math.round(v * 32_767), 44 + i * 2));
  return out;
}

/** A WAV's samples as stored, 16-bit. */
function pcm(bytes: Buffer): Int16Array {
  const at = bytes.indexOf('data', 12);
  const length = bytes.readUInt32LE(at + 4) / 2;
  return Int16Array.from({ length }, (_, i) => bytes.readInt16LE(at + 8 + i * 2));
}

/** A sawtooth: every sample differs from its neighbours, so a part off by one shows. */
const saw = (seconds: number) =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => ((i % 1000) / 1000 - 0.5) * 0.8,
  );

/** Sound and silence: [seconds, loud?] in turn. */
function pattern(parts: [number, boolean][]): Float32Array {
  const out: number[] = [];
  for (const [seconds, loud] of parts) {
    for (let i = 0; i < Math.round(seconds * RATE); i += 1) {
      out.push(loud ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE) : 0);
    }
  }
  return Float32Array.from(out);
}

async function open(page: Page, name: string, samples: Float32Array) {
  await page.goto('/split-audio');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(samples) });
  await expect(page.getByRole('group', { name: /^Timeline/ })).toBeVisible();
}

/** Sets a number in the split settings: in place on desktop, in their sheet on phones. */
async function setNumber(page: Page, isMobile: boolean, label: string, value: string) {
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Where to split/ }).click();
  await (isMobile ? sheet : page).getByRole('spinbutton', { name: label }).fill(value);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
}

async function split(page: Page) {
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('3 equal parts add back up to the file, sample for sample', async ({ page, isMobile }) => {
  const input = saw(12);
  await open(page, 'saw.wav', input);
  await setNumber(page, isMobile, 'Parts', '3');
  const out = await split(page);
  expect(out.name).toBe('saw_parts.zip');
  const entries = unzipStored(out.bytes);
  expect(entries.map((e) => e.name)).toEqual(['saw_01.wav', 'saw_02.wav', 'saw_03.wav']);
  const parts = entries.map((e) => pcm(e.data));
  expect(parts.map((p) => p.length)).toEqual([4 * RATE, 4 * RATE, 4 * RATE]);
  const joined = Int16Array.from(parts.flatMap((p) => Array.from(p)));
  expect(Buffer.from(joined.buffer).equals(Buffer.from(pcm(wav(input)).buffer))).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});

test('pieces of 10 s: two whole ones and what is left', async ({ page, isMobile }) => {
  await open(page, 'long.wav', saw(25));
  await pick(page, isMobile, 'Where to split', 'length');
  await setNumber(page, isMobile, 'Each piece', '10');
  const parts = unzipStored((await split(page)).bytes).map((e) => pcm(e.data).length);
  expect(parts).toEqual([10 * RATE, 10 * RATE, 5 * RATE]);
});

test('at silences, each split is in the middle of the pause', async ({ page, isMobile }) => {
  // Sound 0–3 s, silence 3–5, sound 5–8, silence 8–9.5, sound 9.5–12.
  await open(
    page,
    'talk.wav',
    pattern([
      [3, true],
      [2, false],
      [3, true],
      [1.5, false],
      [2.5, true],
    ]),
  );
  await pick(page, isMobile, 'Where to split', 'silence');
  await expect(page.getByLabel(/^Range 3:/).first()).toBeAttached();
  const parts = unzipStored((await split(page)).bytes).map((e) => pcm(e.data).length / RATE);
  // Cuts at 4.0 and 8.75 s, each within the 10 ms the silence finder works in.
  expect(parts).toHaveLength(3);
  expect(Math.abs((parts[0] ?? 0) - 4)).toBeLessThan(0.02);
  expect(Math.abs((parts[1] ?? 0) - 4.75)).toBeLessThan(0.02);
  expect(Math.abs((parts[2] ?? 0) - 3.25)).toBeLessThan(0.02);
});

test('one part marked by hand downloads as that part alone', async ({ page, isMobile }) => {
  const input = saw(8);
  await open(page, 'saw.wav', input);
  await pick(page, isMobile, 'Where to split', 'marks');
  await setRange(page, '2', '5');
  const out = await split(page);
  expect(out.name).toBe('saw_parts.wav');
  const part = pcm(out.bytes);
  expect(part.length).toBe(3 * RATE);
  expect(part[0]).toBe(pcm(wav(input))[2 * RATE]);
});
