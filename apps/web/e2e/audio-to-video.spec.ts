import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, framePixels, test } from './fixtures';

// A16 Audio to Video (tools/audio.md): 3 s of audio, a tone then silence,
// becomes a 1:1 video whose bars stand tall during the tone and drop in the
// silence, with the title throughout, the caption only while it's timed, and
// the sound itself under the picture.

const RATE = 44_100;

/** A stereo 16-bit WAV at 44.1 kHz: 1.5 s of a 1 kHz tone, then 1.5 s of silence. */
function toneThenSilence(): Buffer {
  const frames = RATE * 3;
  const bytes = frames * 4;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < frames; i += 1) {
    const v =
      i < RATE * 1.5 ? Math.round(0.5 * 32_767 * Math.sin((2 * Math.PI * 1000 * i) / RATE)) : 0;
    out.writeInt16LE(v, 44 + i * 4);
    out.writeInt16LE(v, 46 + i * 4);
  }
  return out;
}

const SRT = '1\n00:00:00,000 --> 00:00:01,200\nHello world\n';

interface Look {
  /** Pink pixels where the bars are. */
  bars: number;
  /** White pixels where the title and the caption go. */
  title: number;
  caption: number;
}

/** What the video shows at each time, counted on a 108 × 108 thumbnail (decoded with WebCodecs, see framePixels). */
async function looks(page: Page, bytes: Buffer, times: number[]): Promise<Look[]> {
  const { frames } = await framePixels(page, bytes, times, { width: 108, height: 108 });
  return frames.map((px) => {
    const count = (
      from: number,
      to: number,
      test: (r: number, g: number, b: number) => boolean,
    ) => {
      let n = 0;
      for (let y = from; y < to; y += 1) {
        for (let x = 0; x < 108; x += 1) {
          const i = (y * 108 + x) * 4;
          if (test(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0)) n += 1;
        }
      }
      return n;
    };
    const pink = (r: number, g: number, b: number) => r > 150 && g < 110 && b > 40 && b < 160;
    // Bright on the black background: text, softened at this size.
    const white = (r: number, g: number, b: number) => r > 110 && g > 110 && b > 110;
    return {
      bars: count(34, 72, pink),
      title: count(8, 29, white),
      caption: count(77, 100, white),
    };
  });
}

/** The video's sound: its length and how loud its first and last half seconds are. */
async function sound(page: Page, bytes: Buffer) {
  return page.evaluate(async (data) => {
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const audio = await new AudioContext().decodeAudioData(raw.buffer);
    const rms = (from: number, to: number) => {
      const plane = audio.getChannelData(0);
      let sum = 0;
      const a = Math.round(from * audio.sampleRate);
      const b = Math.round(to * audio.sampleRate);
      for (let i = a; i < b; i += 1) sum += (plane[i] ?? 0) ** 2;
      return Math.sqrt(sum / (b - a));
    };
    return { duration: audio.duration, tone: rms(0.2, 0.7), silence: rms(2.2, 2.7) };
  }, bytes.toString('base64'));
}

test('a tone then silence: tall bars, then low ones; title throughout, caption while timed; the sound under it', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  await page.goto('/audio-to-video');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneThenSilence() });
  await expect(
    page.getByText('PCM 16-bit · 44.1 kHz · stereo · 0:03').filter({ visible: true }),
  ).toBeVisible();

  const sheet = page.getByRole('dialog', { name: 'Settings' });
  const settings = isMobile ? sheet : page.getByRole('region', { name: 'Settings' });
  const open = async (row: RegExp) => {
    if (isMobile) await page.getByRole('button', { name: row }).click();
  };
  const close = async () => {
    if (!isMobile) return;
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  };
  await open(/^Size/);
  await settings.getByRole('radio', { name: '1:1', exact: true }).click();
  await settings.locator('input[type=color][aria-label="Colour"]').fill('#ff2d55');
  await settings.locator('input[type=color][aria-label="Background"]').fill('#000000');
  await close();
  await open(/^Title/);
  await settings.getByRole('textbox', { name: 'Title' }).fill('Episode one');
  await settings.locator('input[type=file][aria-label="Captions"]').setInputFiles({
    name: 'tone.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from(SRT),
  });
  await close();
  await choose(page, isMobile, 'Format', 'WebM');

  await page.getByRole('button', { name: 'Make video', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 100_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('tone_audiogram.webm');
  const bytes = readFileSync(await file.path());

  const [during, after] = await looks(page, bytes, [0.6, 2.6]);
  // The tone fills the 1 kHz bars; in the silence they fall back to dots.
  expect(during?.bars).toBeGreaterThan(40);
  expect(during?.bars ?? 0).toBeGreaterThan(3 * (after?.bars ?? 0));
  // The title shows all the way through; the caption only for its 1.2 s.
  expect(during?.title).toBeGreaterThan(20);
  expect(after?.title).toBeGreaterThan(20);
  expect(during?.caption).toBeGreaterThan(20);
  expect(after?.caption).toBe(0);

  // The sound: 3 s, the tone where it was, the silence after.
  const audio = await sound(page, bytes);
  expect(audio.duration).toBeGreaterThan(2.9);
  expect(audio.duration).toBeLessThan(3.2);
  expect(audio.tone).toBeGreaterThan(0.2);
  expect(audio.silence).toBeLessThan(0.01);
  expect(await cspViolations(page)).toEqual([]);
});
