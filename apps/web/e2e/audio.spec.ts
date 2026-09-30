import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// A01 Audio Converter (tools/audio.md → Tests).

/** A 16-bit mono WAV of a sine tone. */
function toneWav(seconds: number, rate: number, hz: number): Buffer {
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
    out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12_000), 44 + i * 2);
  }
  return out;
}

async function convert(page: Page, format: string) {
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const button = page.getByRole('button', { name: new RegExp(`^Download ${format}`) }).first();
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('WAV 44.1 → 48 kHz keeps the length to the sample', async ({ page, isMobile }) => {
  await page.goto('/audio-converter');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav(3, 44_100, 440) });
  await choose(page, isMobile, 'Format', 'WAV');
  await choose(page, isMobile, 'Sample rate', '48 kHz');
  const out = await convert(page, 'WAV');
  expect(out.name).toBe('tone.wav');
  expect(out.bytes.readUInt32LE(24)).toBe(48_000);
  const channels = out.bytes.readUInt16LE(22);
  const bits = out.bytes.readUInt16LE(34);
  // The data chunk: 3 s at 48 kHz, to the sample.
  const dataAt = out.bytes.indexOf('data', 12);
  const frames = out.bytes.readUInt32LE(dataAt + 4) / (channels * (bits / 8));
  expect(Math.abs(frames - 144_000)).toBeLessThanOrEqual(1);
});

test('MP3 at 320 kbps has a 320 kbps frame header', async ({ page, isMobile }) => {
  await page.goto('/audio-converter');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav(2, 48_000, 440) });
  // Phones show Bitrate in the Format row's sheet.
  if (isMobile) {
    await page.getByRole('button', { name: /^Format/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await sheet.getByRole('combobox', { name: 'Bitrate' }).selectOption('320');
    await page.keyboard.press('Escape');
  } else {
    await page.getByRole('combobox', { name: 'Bitrate' }).selectOption('320');
  }
  const out = await convert(page, 'MP3');
  // The first frame header after any ID3 tag: MPEG-1 Layer III, bitrate index 14 = 320 kbps.
  let at = 0;
  if (out.bytes.toString('latin1', 0, 3) === 'ID3') {
    const size = out.bytes.subarray(6, 10).reduce((sum, b) => (sum << 7) | b, 0);
    at = 10 + size;
  }
  const KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const frameAt = (from: number) => {
    let i = from;
    while (!(out.bytes[i] === 0xff && ((out.bytes[i + 1] ?? 0) & 0xe0) === 0xe0)) i += 1;
    expect((out.bytes[i + 1] ?? 0) & 0x1e).toBe(0x1a); // MPEG-1, Layer III
    const kbps = KBPS[(out.bytes[i + 2] ?? 0) >> 4] ?? 0;
    const padding = ((out.bytes[i + 2] ?? 0) >> 1) & 1;
    return { at: i, kbps, length: Math.floor((144_000 * kbps) / 48_000) + padding };
  };
  // The first frame is the Xing/Info header; the audio frames follow it.
  const info = frameAt(at);
  const audio = frameAt(info.at + info.length);
  expect(audio.kbps).toBe(320);
  expect(frameAt(audio.at + audio.length).kbps).toBe(320);
});

test('the WAV to MP3 pair page is preset to MP3, with its own copy', async ({ page, isMobile }) => {
  await page.goto('/convert/wav-to-mp3');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('WAV to MP3 Converter');
  // Phones show the settings once a file is in; desktop shows them from the start.
  if (!isMobile) {
    await expect(page.getByRole('radio', { name: 'MP3', exact: true }).first()).toBeChecked();
  }
  await expect(page.getByText(/WAV is uncompressed audio/)).toBeVisible();
});

// A02 Trim Audio (tools/audio.md → Tests).

/** Frames in a WAV's data chunk. */
function wavFrames(bytes: Buffer): number {
  const channels = bytes.readUInt16LE(22);
  const bits = bytes.readUInt16LE(34);
  const dataAt = bytes.indexOf('data', 12);
  return bytes.readUInt32LE(dataAt + 4) / (channels * (bits / 8));
}

async function trimTone(page: Page) {
  await page.goto('/trim-audio');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav(20, 48_000, 440) });
  await expect(
    page.getByText('PCM 16-bit · 48 kHz · mono · 0:20').filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Out point' }).fill('15');
  await page.getByRole('textbox', { name: 'Out point' }).press('Enter');
  await page.getByRole('textbox', { name: 'In point' }).fill('5');
  await page.getByRole('textbox', { name: 'In point' }).press('Enter');
}

async function trimmed(page: Page) {
  await page.getByRole('button', { name: 'Trim', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('trims a WAV 5.000–15.000 to 10.000 s, to the sample', async ({ page }) => {
  await trimTone(page);
  // The waveform is drawn from the file.
  await expect(page.getByRole('group', { name: /^Timeline/ })).toBeVisible();
  const out = await trimmed(page);
  expect(out.name).toBe('tone_trimmed.wav');
  expect(wavFrames(out.bytes)).toBe(480_000);
  await expect(
    page.getByText('PCM: cut to the sample, lossless').filter({ visible: true }),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('removes a range, joins the sides and fades out', async ({ page, isMobile }) => {
  await trimTone(page);
  await choose(page, isMobile, 'Selection', 'Remove it');
  if (isMobile) {
    // Phones show Fade out in the Fade in row's sheet.
    await page.getByRole('button', { name: /^Fade in/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await sheet.getByRole('combobox', { name: 'Fade out' }).selectOption('1000');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  } else {
    await page.getByRole('combobox', { name: 'Fade out' }).selectOption('1000');
  }
  await choose(page, isMobile, isMobile ? 'Selection' : 'Format', 'WAV');
  const out = await trimmed(page);
  expect(out.name).toBe('tone_trimmed.wav');
  expect(wavFrames(out.bytes)).toBe(480_000);
  // The last sample is faded to silence.
  expect(Math.abs(out.bytes.readInt16LE(out.bytes.length - 2))).toBeLessThan(50);
  await expect(
    page.getByText('Removed 5.000 s – 15.000 s; 10.000 s left').filter({ visible: true }),
  ).toBeVisible();
});

test('removes two ranges and joins what’s left', async ({ page, isMobile }) => {
  await trimTone(page);
  await choose(page, isMobile, 'Selection', 'Remove it');
  // A second range goes after the first (15–16 s); make it 16.000–17.000 s.
  await page.getByRole('button', { name: 'Add range' }).click();
  await expect(page.getByRole('button', { name: /^Range 2:/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('textbox', { name: 'Out point' }).fill('17');
  await page.getByRole('textbox', { name: 'Out point' }).press('Enter');
  await page.getByRole('textbox', { name: 'In point' }).fill('16');
  await page.getByRole('textbox', { name: 'In point' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Range 2: 00:16.000 to 00:17.000' })).toBeVisible();
  await expect(page.getByText('2 ranges · 11.00 s')).toBeVisible();
  const out = await trimmed(page);
  expect(wavFrames(out.bytes)).toBe(9 * 48_000);
  await expect(
    page.getByText('Removed 2 parts; 9.000 s left').filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText('A 10 ms crossfade at each of the 2 joins, so they don’t click')
      .filter({ visible: true }),
  ).toBeVisible();
});

// A03 BPM & Key Finder (tools/audio.md → Tests; the full labelled set is in @etb/core's tests).

/** 16 s at 22.05 kHz: drums at 120 BPM over I–IV–V–I in C major, as a 16-bit WAV. */
function song(): Buffer {
  const rate = 22_050;
  const seconds = 16;
  const samples = new Float32Array(rate * seconds);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (seed / 2_147_483_648) * 2 - 1;
  };
  const beat = rate / 2;
  for (let b = 0; b * beat < samples.length; b += 1) {
    const at = Math.round(b * beat);
    for (let i = 0; i < 0.08 * rate && at + i < samples.length; i += 1) {
      const t = i / rate;
      samples[at + i] =
        (samples[at + i] ?? 0) +
        (b % 2 === 0
          ? Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) * Math.exp(-t * 25)
          : rand() * 0.5 * Math.exp(-t * 40));
    }
  }
  const chords = [
    [48, 60, 64, 67],
    [53, 65, 69, 72],
    [55, 67, 71, 74],
    [48, 60, 64, 67],
  ];
  const per = rate * 2;
  for (let c = 0; c * per < samples.length; c += 1) {
    for (const midi of chords[c % 4] ?? []) {
      const f = 440 * 2 ** ((midi - 69) / 12);
      for (let i = 0; i < per; i += 1) {
        const t = i / rate;
        const v = Math.sin(2 * Math.PI * f * t) + Math.sin(4 * Math.PI * f * t) / 2;
        samples[c * per + i] = (samples[c * per + i] ?? 0) + (v * Math.exp(-t)) / 8;
      }
    }
  }
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.6)) * 32_000), 44 + i * 2);
  });
  return out;
}

test('finds 120 BPM and C major, and exports the beats', async ({ page }) => {
  await page.goto('/bpm-key-finder');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: song() });
  const main = page.locator('main');
  await expect(main.getByText(/^1(19\.\d|20(\.\d)?|21\.0) BPM$/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(main.getByText('C major', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('8B', { exact: true }).first()).toBeVisible();
  const download = page.getByRole('button', { name: /^Download/ }).first();
  const saved = page.waitForEvent('download');
  await download.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('song_beats.csv');
  const lines = readFileSync(await file.path(), 'utf8')
    .trim()
    .split('\n');
  expect(lines[0]).toBe('beat,seconds');
  // 16 s at 120 BPM: a beat every 0.5 s.
  expect(lines.length - 1).toBeGreaterThanOrEqual(30);
  expect(await cspViolations(page)).toEqual([]);
});

test('tap tempo reads the taps, and the metronome starts and stops', async ({ page }) => {
  // The page's clock is Playwright's, so the taps are exactly 400 ms apart.
  await page.clock.install();
  await page.goto('/bpm-key-finder');
  await page.clock.pauseAt(Date.now() + 1000);
  const pad = page.getByRole('button', { name: 'Tap', exact: true });
  for (let i = 0; i < 6; i += 1) {
    await pad.click();
    if (i < 5) await page.clock.runFor(400);
  }
  await expect(page.getByText('150 BPM', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use for the metronome' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Tempo' })).toHaveValue('150');
  const start = page.getByRole('button', { name: 'Start' });
  await start.click();
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
});
