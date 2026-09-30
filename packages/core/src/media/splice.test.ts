import { describe, expect, it } from 'vitest';

import { Splicer } from './splice';

const RATE = 48_000;

/** A sine, `seconds` long, in one channel. */
function tone(seconds: number, hz: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / RATE),
  );
}

/** Feeds `source` through the splicer in blocks, and returns everything it emits. */
function run(splicer: Splicer, source: Float32Array[], block = 1024): Float32Array[] {
  const channels = source.length;
  const out = Array.from({ length: channels }, () => new Float32Array(splicer.length));
  const take = (r: { planes: Float32Array[]; at: number } | null) => {
    if (!r) return;
    r.planes.forEach((p, c) => {
      out[c]?.set(p, r.at);
    });
  };
  const total = source[0]?.length ?? 0;
  for (let f = 0; f < total; f += block) {
    take(
      splicer.push(
        source.map((p) => p.subarray(f, Math.min(total, f + block))),
        f,
      ),
    );
  }
  take(splicer.finish());
  return out;
}

/** The biggest jump between neighbouring samples in [from, to). */
function maxStep(x: Float32Array, from: number, to: number): number {
  let m = 0;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i += 1) {
    m = Math.max(m, Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)));
  }
  return m;
}

describe('splicer', () => {
  it('is exactly as long as the kept spans, to the frame', () => {
    const source = [tone(20, 440)];
    const splicer = new Splicer({
      spans: [
        { start: 1, end: 3.25 },
        { start: 5, end: 6.5 },
        { start: 10, end: 19.999 },
      ],
      rate: RATE,
      channels: 1,
      duration: 20,
    });
    const [out] = run(splicer, source);
    expect(out?.length).toBe(
      Math.round(2.25 * RATE) + Math.round(1.5 * RATE) + Math.round(9.999 * RATE),
    );
  });

  it('copies a span untouched away from the joins', () => {
    const source = [tone(10, 440)];
    const [out] = run(
      new Splicer({ spans: [{ start: 2, end: 6 }], rate: RATE, channels: 1, duration: 10 }),
      source,
    );
    const offset = 2 * RATE;
    for (const i of [0, 1000, 50_000, 191_999]) {
      expect(out?.[i]).toBeCloseTo(source[0]?.[offset + i] ?? NaN, 6);
    }
  });

  it('joins without a click: the crossfade keeps the steps small', () => {
    // A 100 Hz sine cut mid-cycle and joined half a cycle later: a hard cut
    // jumps by up to 2; the 10 ms crossfade keeps every step near the sine's own.
    const source = [tone(4, 100)];
    const spans = [
      { start: 0.5, end: 1.0025 },
      { start: 2.0075, end: 3 },
    ];
    const [out] = run(new Splicer({ spans, rate: RATE, channels: 1, duration: 4 }), source);
    const join = Math.round(0.5025 * RATE);
    const natural = maxStep(source[0] ?? new Float32Array(), 0, RATE);
    expect(maxStep(out ?? new Float32Array(), join - 480, join + 480)).toBeLessThan(natural * 1.5);

    // The same cut with no crossfade clicks.
    const [hard] = run(
      new Splicer({ spans, rate: RATE, channels: 1, duration: 4, crossfade: 0 }),
      source,
    );
    expect(maxStep(hard ?? new Float32Array(), join - 2, join + 2)).toBeGreaterThan(natural * 20);
  });

  it('crossfades to full level: the gains either side of a join add up to one', () => {
    // A constant signal stays constant through the join.
    const source = [new Float32Array(4 * RATE).fill(0.5)];
    const [out] = run(
      new Splicer({
        spans: [
          { start: 0, end: 1 },
          { start: 2, end: 3 },
        ],
        rate: RATE,
        channels: 1,
        duration: 4,
      }),
      source,
    );
    for (let i = RATE - 300; i < RATE + 300; i += 1) expect(out?.[i]).toBeCloseTo(0.5, 5);
  });

  it('fades in and out over the whole result', () => {
    const source = [new Float32Array(3 * RATE).fill(1)];
    const [out] = run(
      new Splicer({
        spans: [{ start: 0.5, end: 2.5 }],
        rate: RATE,
        channels: 1,
        duration: 3,
        fadeIn: 0.5,
        fadeOut: 1,
      }),
      source,
    );
    expect(out?.[0]).toBeLessThan(0.001);
    expect(out?.[Math.round(0.25 * RATE)]).toBeCloseTo(0.5, 2);
    expect(out?.[Math.round(0.75 * RATE)]).toBe(1);
    expect(out?.[Math.round(1.5 * RATE)]).toBeCloseTo(0.5, 2);
    expect(out?.at(-1)).toBeLessThan(0.001);
  });

  it('streams: holds back only the crossfade, and fills silence if the audio stops short', () => {
    const splicer = new Splicer({
      spans: [
        { start: 0, end: 1 },
        { start: 1.5, end: 2 },
      ],
      rate: RATE,
      channels: 2,
      duration: 2,
    });
    const first = splicer.push([tone(1, 440), tone(1, 440)], 0);
    // Everything before the first join's crossfade is out already.
    expect(first?.at).toBe(0);
    expect(first?.planes[0]?.length).toBe(RATE - 240);
    const rest = splicer.finish();
    expect((rest?.at ?? 0) + (rest?.planes[1]?.length ?? 0)).toBe(splicer.length);
    expect(Math.max(...(rest?.planes[0]?.slice(480) ?? []))).toBe(0);
  });

  it('reads each source frame once: margins that meet are merged', () => {
    const splicer = new Splicer({
      spans: [
        { start: 1, end: 5 },
        { start: 5.002, end: 8 },
        { start: 9, end: 10 },
      ],
      rate: RATE,
      channels: 1,
      duration: 10,
    });
    expect(splicer.windows).toEqual([
      { start: 1, end: 8.005 },
      { start: 8.995, end: 10 },
    ]);
  });
});
