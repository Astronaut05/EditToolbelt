import { describe, expect, it } from 'vitest';

import {
  flacBytes,
  HumMeter,
  humGuess,
  LEVEL_WINDOW_SEC,
  NOISE_PREVIEW_SECONDS,
  previewStart,
} from './noise';

/** Levels for `seconds` of windows: speech bursts over a background at `floor` dB. */
function stretch(seconds: number, floor: number, voice: number | null = -20): number[] {
  return Array.from({ length: Math.round(seconds / LEVEL_WINDOW_SEC) }, (_, i) =>
    voice !== null && i % 10 < 6 ? voice : floor,
  );
}

describe('previewStart', () => {
  it('starts at 0 for a file no longer than the preview', () => {
    expect(previewStart(stretch(10, -40), LEVEL_WINDOW_SEC)).toBe(0);
    expect(previewStart([], LEVEL_WINDOW_SEC)).toBe(0);
  });

  it('picks the stretch with the loudest background under speech', () => {
    const levels = [...stretch(20, -60), ...stretch(15, -35), ...stretch(20, -55)];
    const start = previewStart(levels, LEVEL_WINDOW_SEC);
    // At most a second or two of the quieter part before it.
    expect(start).toBeGreaterThanOrEqual(18);
    expect(start + NOISE_PREVIEW_SECONDS).toBeLessThanOrEqual(35);
  });

  it('skips stretches with nobody speaking, however loud', () => {
    const levels = [...stretch(12, -50), ...stretch(20, -25, null), ...stretch(12, -45)];
    const start = previewStart(levels, LEVEL_WINDOW_SEC);
    // Not the quieter first words, and not the noise alone: some of the last words.
    expect(start).toBeGreaterThan(22);
    expect(start).toBeLessThanOrEqual(34);
  });

  it('falls back to the start when nothing looks like speech, and ignores silence', () => {
    expect(previewStart(stretch(40, -50, null), LEVEL_WINDOW_SEC)).toBe(0);
    const silent = Array<number>(400).fill(-Infinity);
    const start = previewStart([...silent, ...stretch(15, -40)], LEVEL_WINDOW_SEC);
    expect(start).toBeGreaterThanOrEqual(19);
    expect(start).toBeLessThanOrEqual(20);
  });
});

describe('flacBytes', () => {
  it('allows 70 % of 16-bit PCM', () => {
    // An hour of stereo at 48 kHz: 691 MB as PCM.
    expect(flacBytes(3600, 48000, 2)).toBe(Math.ceil(3600 * 48000 * 4 * 0.7) + 8192);
  });
});

function sine(rate: number, seconds: number, hz: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate),
  );
}

describe('HumMeter and humGuess', () => {
  it('hears 50 Hz hum, a little off frequency, under a voice-like tone', () => {
    const meter = new HumMeter(16_000);
    const hum = sine(16_000, 4, 50.2, 0.03);
    const voice = sine(16_000, 4, 140, 0.3);
    meter.push(hum.map((v, i) => v + (voice[i] ?? 0)));
    const levels = meter.result();
    // A sine's power is A² / 2; 0.2 Hz off its bin costs about 0.6 dB.
    expect(Math.abs((levels[50] ?? 0) - (20 * Math.log10(0.03) - 3))).toBeLessThan(1);
    expect(humGuess(levels)).toBe('50');
  });

  it('tells 60 Hz from 50 Hz, and says off with no hum', () => {
    const sixty = new HumMeter(8000);
    sixty.push(sine(8000, 3, 60, 0.01));
    expect(humGuess(sixty.result())).toBe('60');
    const clean = new HumMeter(8000);
    clean.push(sine(8000, 3, 140, 0.3));
    expect(humGuess(clean.result())).toBe('off');
    expect(humGuess(new HumMeter(8000).result())).toBe('off');
  });
});
