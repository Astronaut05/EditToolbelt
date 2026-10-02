import { describe, expect, it } from 'vitest';

import {
  AudiogramAnalyser,
  audiogramLayout,
  AUDIOGRAM_SIZES,
  BARS,
  cueAt,
  fft,
  WAVE_POINTS,
  wrapLines,
} from './audiogram';

const RATE = 48_000;

/** `seconds` of a sine at `hz` and `amp`, in blocks of `block` samples. */
function* sine(hz: number, amp: number, seconds: number, block = 4096) {
  const total = Math.round(seconds * RATE);
  for (let at = 0; at < total; at += block) {
    const n = Math.min(block, total - at);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * (at + i)) / RATE);
    yield out;
  }
}

/** The bar a frequency falls in (50 Hz to 16 kHz, log). */
const barOf = (hz: number) => Math.floor((BARS * Math.log(hz / 50)) / Math.log(16_000 / 50));

describe('fft', () => {
  it('puts a sine of 4 cycles in bin 4', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 4 * i) / 64));
    const im = new Float64Array(64);
    fft(re, im);
    const mags = [...re].map((r, i) => Math.hypot(r, im[i] ?? 0));
    expect(mags[4]).toBeCloseTo(32, 6);
    expect(mags[60]).toBeCloseTo(32, 6);
    expect(Math.max(...mags.filter((_, i) => i !== 4 && i !== 60))).toBeLessThan(1e-9);
  });
});

describe('AudiogramAnalyser', () => {
  it('lights the bar a tone falls in, and the waveform swings with it', () => {
    const frames = 30;
    const analyser = new AudiogramAnalyser(RATE, frames);
    for (const block of sine(1000, 0.05, 1)) analyser.push(block);
    const { bars, wave } = analyser.finish();
    const k = 15;
    const row = [...bars.subarray(k * BARS, (k + 1) * BARS)];
    const loudest = row.indexOf(Math.max(...row));
    expect(loudest).toBe(barOf(1000));
    // −26 dBFS: (−26 + 70) / 60 of the way up.
    expect(row[loudest]).toBeCloseTo(44 / 60, 1);
    expect(row[2]).toBeLessThan(0.3);
    // The waveform line, scaled so the loudest moment reaches 0.9.
    const line = [...wave.subarray(k * WAVE_POINTS, (k + 1) * WAVE_POINTS)];
    expect(Math.max(...line)).toBeGreaterThan(0.85);
    expect(Math.min(...line)).toBeLessThan(-0.85);
  });

  it('is the same however the audio is cut into blocks', () => {
    const run = (block: number) => {
      const analyser = new AudiogramAnalyser(RATE, 20);
      for (const b of sine(440, 0.3, 0.7, block)) analyser.push(b);
      return analyser.finish();
    };
    const a = run(4096);
    const b = run(333);
    expect([...a.bars]).toEqual([...b.bars]);
    expect([...a.wave]).toEqual([...b.wave]);
  });

  it('lets bars fall back gradually once the sound stops, and counts missing audio as silence', () => {
    const analyser = new AudiogramAnalyser(RATE, 60);
    for (const block of sine(250, 0.8, 1)) analyser.push(block);
    const { bars, wave } = analyser.finish();
    const bar = barOf(250);
    const at = (k: number) => bars[k * BARS + bar] ?? 0;
    expect(at(20)).toBeGreaterThan(0.9);
    // After the end (1 s = frame 30) it falls by 0.82 a frame rather than at once.
    expect(at(33)).toBeLessThan(at(31));
    expect(at(33)).toBeGreaterThan(0.3);
    expect(at(59)).toBeLessThan(0.01);
    expect(Math.max(...wave.subarray(50 * WAVE_POINTS, 51 * WAVE_POINTS))).toBe(0);
  });
});

describe('audiogramLayout', () => {
  it('stacks title, sound and captions without overlap, inside the margins, in every shape', () => {
    for (const { width, height } of Object.values(AUDIOGRAM_SIZES)) {
      const { title, visual, captions } = audiogramLayout(width, height);
      expect(title.y + title.height).toBeLessThanOrEqual(visual.y);
      expect(visual.y + visual.height).toBeLessThanOrEqual(captions.y);
      expect(captions.y + captions.height).toBeLessThanOrEqual(height);
      for (const box of [title, visual, captions]) {
        expect(box.x).toBeGreaterThan(0);
        expect(box.x + box.width).toBeLessThan(width);
      }
      expect(title.size).toBeGreaterThan(captions.size);
    }
  });
});

describe('wrapLines', () => {
  const measure = (text: string) => text.length * 10;

  it('wraps at spaces, keeps line breaks, and breaks a word too long for a line', () => {
    expect(wrapLines('one two three four', 90, measure)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('first\nsecond', 200, measure)).toEqual(['first', 'second']);
    expect(wrapLines('abcdefghijkl', 50, measure)).toEqual(['abcde', 'fghij', 'kl']);
  });

  it('ends the last line with … when there are too many', () => {
    expect(wrapLines('aa bb cc dd ee', 50, measure, 2)).toEqual(['aa bb', 'cc…']);
  });
});

describe('cueAt', () => {
  it('finds the caption showing at a time, without its styling tags', () => {
    const cues = [
      { start: 0, end: 1500, text: 'Hello <i>there</i>' },
      { start: 2000, end: 3000, text: 'Again' },
    ];
    expect(cueAt(cues, 1)).toBe('Hello there');
    expect(cueAt(cues, 1.7)).toBeNull();
    expect(cueAt(cues, 2.5)).toBe('Again');
  });
});
