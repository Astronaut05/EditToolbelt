import { describe, expect, it } from 'vitest';

import { Resampler } from './resample';

const tone = (rate: number, hz: number, seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate),
  );

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (x[i] ?? 0) ** 2;
  return Math.sqrt(sum / (to - from));
};

/** Runs a whole signal through in uneven blocks. */
function run(r: Resampler, x: Float32Array, block = 1000): Float32Array {
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length;) {
    const end = Math.min(x.length, i + block);
    parts.push(r.push([x.subarray(i, end)])[0] ?? new Float32Array(0));
    i = end;
    block = block === 1000 ? 777 : 1000;
  }
  parts.push(r.flush()[0] ?? new Float32Array(0));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('Resampler', () => {
  it('takes 44.1 kHz to 48 kHz: exact length, same level and pitch', () => {
    const out = run(new Resampler(44_100, 48_000, 1), tone(44_100, 1000, 1));
    expect(out.length).toBe(48_000);
    const mid = rms(out, 4800, 43_200);
    expect(20 * Math.log10(mid / (0.5 / Math.SQRT2))).toBeCloseTo(0, 1);
    // Against a 1 kHz tone made at 48 kHz: the same signal.
    const want = tone(48_000, 1000, 1);
    let worst = 0;
    for (let i = 4800; i < 43_200; i += 1)
      worst = Math.max(worst, Math.abs((out[i] ?? 0) - (want[i] ?? 0)));
    expect(worst).toBeLessThan(0.002);
  });

  it('keeps a steady level steady, and a stream equal to one block', () => {
    const dc = new Float32Array(48_000).fill(0.25);
    const out = run(new Resampler(48_000, 44_100, 1), dc);
    expect(out.length).toBe(44_100);
    for (let i = 100; i < 44_000; i += 997) expect(out[i]).toBeCloseTo(0.25, 6);
    const x = tone(48_000, 440, 0.5);
    const whole = new Resampler(48_000, 32_000, 1);
    const once = [...(whole.push([x])[0] ?? []), ...(whole.flush()[0] ?? [])];
    const streamed = run(new Resampler(48_000, 32_000, 1), x);
    expect(streamed.length).toBe(once.length);
    for (let i = 0; i < once.length; i += 101) expect(streamed[i]).toBeCloseTo(once[i] ?? 0, 6);
  });

  it('filters what the lower rate can’t hold instead of folding it back', () => {
    // 15 kHz is above 22.05 kHz audio's 11.025 kHz limit.
    const out = run(new Resampler(48_000, 22_050, 1), tone(48_000, 15_000, 1));
    expect(20 * Math.log10(rms(out, 2000, 20_000) / (0.5 / Math.SQRT2))).toBeLessThan(-60);
  });

  it('passes the same rate through untouched, every channel', () => {
    const left = tone(48_000, 300, 0.1);
    const right = tone(48_000, 500, 0.1);
    const [l, r] = new Resampler(48_000, 48_000, 2).push([left, right]);
    expect(l).toEqual(left);
    expect(r).toEqual(right);
  });
});
