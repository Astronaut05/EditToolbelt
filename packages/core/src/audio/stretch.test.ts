import { describe, expect, it } from 'vitest';

import { Resampler } from './resample';
import { TimeStretch } from './stretch';

const RATE = 48_000;
const tone = (hz: number, seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(RATE * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE),
  );

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Runs a mono signal through in uneven blocks. */
function stretch(x: Float32Array, ratio: number): Float32Array {
  const s = new TimeStretch(1, ratio);
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length;) {
    const end = Math.min(x.length, i + 3001);
    parts.push(s.push([x.subarray(i, end)])[0] ?? new Float32Array(0));
    i = end;
  }
  parts.push(s.flush()[0] ?? new Float32Array(0));
  return concat(parts);
}

/** Frequency from zero crossings over the middle of a signal. */
function hz(x: Float32Array): number {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let crossings = 0;
  for (let i = a + 1; i < b; i += 1) if ((x[i - 1] ?? 0) < 0 !== (x[i] ?? 0) < 0) crossings += 1;
  return crossings / 2 / ((b - a) / RATE);
}

const rms = (x: Float32Array) => {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += (x[i] ?? 0) ** 2;
  return Math.sqrt(sum / (b - a));
};

describe('TimeStretch', () => {
  it('plays 125% as fast at the same pitch: 0.8 × the length (the spec’s test)', () => {
    const out = stretch(tone(440, 4), 0.8);
    expect(out.length).toBe(Math.round(4 * RATE * 0.8));
    expect(Math.abs(hz(out) - 440)).toBeLessThan(1);
    expect(20 * Math.log10(rms(out) / (0.5 / Math.SQRT2))).toBeCloseTo(0, 0);
  });

  it('slows to half speed and back up to quadruple, keeping the pitch', () => {
    for (const ratio of [2, 0.25]) {
      const out = stretch(tone(330, 3), ratio);
      expect(out.length).toBe(Math.round(3 * RATE * ratio));
      expect(Math.abs(hz(out) - 330)).toBeLessThan(1);
    }
  });

  it('with the resampler, moves a 440 Hz tone up 2 semitones to 493.9 Hz at the same length', () => {
    const r = 2 ** (2 / 12);
    const longer = stretch(tone(440, 4), r);
    const resampler = new Resampler(RATE * r, RATE, 1);
    const out = concat([
      resampler.push([longer])[0] ?? new Float32Array(0),
      resampler.flush()[0] ?? new Float32Array(0),
    ]);
    expect(Math.abs(out.length - 4 * RATE)).toBeLessThanOrEqual(1);
    expect(Math.abs(hz(out) - 493.88)).toBeLessThan(1);
  });

  it('passes the input through at a ratio of 1', () => {
    const x = tone(440, 0.5);
    expect(stretch(x, 1)).toEqual(x);
  });
});
