import { describe, expect, it } from 'vitest';

import {
  applyPlan,
  kWeighting,
  limiterKnots,
  LoudnessScan,
  measure,
  planNormalize,
  type ScanResult,
} from './loudness';

/** The EBU's signals are a minute or more of 48 kHz stereo each: slow on a busy CI machine. */
const LONG = { timeout: 60_000 };

/** A sine at `db` dBFS peak. */
function sine(rate: number, seconds: number, db: number, freq = 1000, phase = 0): Float32Array {
  const n = Math.round(rate * seconds);
  const a = 10 ** (db / 20);
  return Float32Array.from(
    { length: n },
    (_, i) => a * Math.sin(2 * Math.PI * freq * (i / rate) + phase),
  );
}

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Scans planar audio in blocks of `chunk` frames, as a decoder would hand it over. */
function scan(rate: number, planes: Float32Array[], chunk = 4096, perMs = false): ScanResult {
  const scanner = new LoudnessScan(rate, planes.length, { perMs });
  const n = planes[0]?.length ?? 0;
  for (let i = 0; i < n; i += chunk) {
    scanner.push(planes.map((plane) => plane.subarray(i, Math.min(n, i + chunk))));
  }
  return scanner.finish();
}

const stereo = (plane: Float32Array) => [plane, plane];

/** The same generator as the pyloudnorm script that made the reference values. */
function lcg(seed: number, n: number): Float64Array {
  const out = new Float64Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 4294967296) * 2 - 1;
  }
  return out;
}

describe('K-weighting', () => {
  it('matches the coefficients BS.1770 lists for 48 kHz', () => {
    const [shelf, highPass] = kWeighting(48_000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 6);
  });
});

describe('EBU Tech 3341 (integrated, momentary, short-term)', () => {
  const rate = 48_000;

  it('case 1 and 2: a stereo 1 kHz sine at -23 and -33 dBFS', LONG, () => {
    expect(measure(scan(rate, stereo(sine(rate, 20, -23)))).integrated).toBeCloseTo(-23, 1);
    expect(measure(scan(rate, stereo(sine(rate, 20, -33)))).integrated).toBeCloseTo(-33, 1);
  });

  it('case 3, 4 and 5: the gates leave out the quiet parts', LONG, () => {
    const case3 = join(sine(rate, 10, -36), sine(rate, 60, -23), sine(rate, 10, -36));
    const case4 = join(
      sine(rate, 10, -72),
      sine(rate, 10, -36),
      sine(rate, 60, -23),
      sine(rate, 10, -36),
      sine(rate, 10, -72),
    );
    const case5 = join(sine(rate, 20, -26), sine(rate, 20.1, -20), sine(rate, 20, -26));
    for (const signal of [case3, case4, case5]) {
      expect(Math.abs(measure(scan(rate, stereo(signal))).integrated + 23)).toBeLessThan(0.1);
    }
  });

  it('a steady sine reads the same momentary, short-term and integrated', () => {
    const m = measure(scan(rate, stereo(sine(rate, 10, -23))));
    expect(Math.abs(m.momentaryMax + 23)).toBeLessThan(0.1);
    expect(Math.abs(m.shortTermMax + 23)).toBeLessThan(0.1);
    // Every 100 ms from 0.4 s, and from 3 s.
    expect(m.momentary.length).toBe(97);
    expect(m.shortTerm.length).toBe(71);
  });

  it('5.1: the surrounds count 1.5 dB more, the LFE not at all', () => {
    const tone = sine(rate, 10, -28);
    const silent = new Float32Array(tone.length);
    // Left alone, then a surround alone: 1.41 times the energy.
    const left = measure(scan(rate, [tone, silent, silent, silent, silent, silent])).integrated;
    const surround = measure(scan(rate, [silent, silent, silent, silent, tone, silent])).integrated;
    const lfe = measure(scan(rate, [silent, silent, silent, tone, silent, silent])).integrated;
    expect(surround - left).toBeCloseTo(10 * Math.log10(1.41), 2);
    expect(lfe).toBe(-Infinity);
  });

  it('silence has no loudness', () => {
    const m = measure(scan(rate, stereo(new Float32Array(rate * 2))));
    expect(m.integrated).toBe(-Infinity);
    expect(m.truePeak).toBe(-Infinity);
  });
});

describe('EBU Tech 3342 (loudness range)', () => {
  const rate = 48_000;
  const lra = (...parts: [number, number][]) =>
    measure(scan(rate, stereo(join(...parts.map(([s, db]) => sine(rate, s, db)))))).range;

  it('cases 1 to 4 within 1 LU', LONG, () => {
    expect(Math.abs(lra([20, -20], [20, -30]) - 10)).toBeLessThan(1);
    expect(Math.abs(lra([20, -20], [20, -15]) - 5)).toBeLessThan(1);
    expect(Math.abs(lra([20, -40], [20, -20]) - 20)).toBeLessThan(1);
    expect(Math.abs(lra([20, -50], [20, -35], [20, -20], [20, -35], [20, -50]) - 15)).toBeLessThan(
      1,
    );
  });
});

describe('against pyloudnorm', () => {
  // Values from pyloudnorm 0.1.1 on the same signals (float32 samples).
  it('noise, loud-quiet-loud, at 44.1 kHz stereo', LONG, () => {
    const rate = 44_100;
    const n = rate * 25;
    const env = (i: number) => (i < rate * 10 ? 0.1 : i < rate * 20 ? 0.01 : 0.3);
    const l = lcg(1, n);
    const r = lcg(2, n);
    const planes = [
      Float32Array.from(l, (v, i) => v * env(i)),
      Float32Array.from(r, (v, i) => v * env(i)),
    ];
    expect(Math.abs(measure(scan(rate, planes)).integrated - -13.155)).toBeLessThan(0.1);
  });

  it('two tones at 44.1 kHz mono', () => {
    const rate = 44_100;
    const plane = Float32Array.from(
      { length: rate * 12 },
      (_, i) =>
        0.25 * Math.sin(2 * Math.PI * 100 * (i / rate)) +
        0.1 * Math.sin(2 * Math.PI * 5000 * (i / rate)),
    );
    expect(Math.abs(measure(scan(rate, [plane])).integrated - -15.0875)).toBeLessThan(0.1);
  });

  it('five channels of noise at 48 kHz', LONG, () => {
    const rate = 48_000;
    const amps = [0.1, 0.1, 0.05, 0.2, 0.2];
    const planes = amps.map((a, i) => Float32Array.from(lcg(3 + i, rate * 8), (v) => v * a));
    expect(Math.abs(measure(scan(rate, planes)).integrated - -10.362)).toBeLessThan(0.1);
  });

  it('noise at 96 kHz', LONG, () => {
    const rate = 96_000;
    const l = lcg(9, rate * 6);
    const planes = [Float32Array.from(l, (v) => v * 0.2), Float32Array.from(l, (v) => v * 0.1)];
    expect(Math.abs(measure(scan(rate, planes)).integrated - -14.5858)).toBeLessThan(0.1);
  });
});

describe('true peak', () => {
  it('finds the peak between samples: a quarter-rate sine sampled at 45°', () => {
    const rate = 48_000;
    // Samples land at ±0.707; the wave peaks at 1.0 between them. Faded in and out over
    // 10 ms, as a hard start is itself a peak above the sine's.
    const fade = rate / 100;
    const plane = sine(rate, 1, 0, rate / 4, Math.PI / 4).map(
      (v, i, all) => v * Math.min(1, i / fade, (all.length - 1 - i) / fade),
    );
    const m = measure(scan(rate, stereo(plane)));
    expect(m.samplePeak).toBeCloseTo(-3.01, 1);
    expect(Math.abs(m.truePeak)).toBeLessThan(0.1);
  });

  it('reads a full-scale 997 Hz sine at 0 dBTP, whatever the block size', () => {
    const rate = 44_100;
    const plane = sine(rate, 2, 0, 997);
    for (const chunk of [1, 37, 1024, 100_000]) {
      expect(Math.abs(measure(scan(rate, [plane], chunk)).truePeak)).toBeLessThan(0.05);
    }
  });

  it('gives each millisecond its peak and energy', () => {
    const rate = 48_000;
    const plane = join(sine(rate, 0.5, -20), sine(rate, 0.5, -6));
    const result = scan(rate, [plane], 333, true);
    const ms = result.ms;
    expect(ms?.frames).toBe(48);
    expect(ms?.peak.length).toBe(1000);
    expect(ms?.energy.length).toBe(1000);
    expect(20 * Math.log10(ms?.peak[100] ?? 0)).toBeCloseTo(-20, 0);
    expect(20 * Math.log10(ms?.peak[900] ?? 0)).toBeCloseTo(-6, 0);
  });
});

describe('normalizing', () => {
  const rate = 48_000;

  /** Runs a plan over audio in decoder-sized blocks and measures the result. */
  function normalize(
    planes: Float32Array[],
    options: { target: number; ceiling: number; limit: boolean },
    chunk = 1152,
  ) {
    const plan = planNormalize(scan(rate, planes, chunk, true), options);
    const out = planes.map((plane) => plane.slice());
    const n = out[0]?.length ?? 0;
    for (let i = 0; i < n; i += chunk) {
      applyPlan(
        out.map((plane) => plane.subarray(i, Math.min(n, i + chunk))),
        i,
        plan,
      );
    }
    return { plan, result: measure(scan(rate, out)) };
  }

  /** A steady tone at -20 dBFS with a 2 ms burst near full scale every half second: peaky. */
  function peaky(seconds: number): Float32Array {
    const plane = sine(rate, seconds, -20, 440);
    const burst = lcg(5, plane.length);
    for (let start = rate / 4; start < plane.length; start += rate / 2) {
      for (let i = 0; i < rate / 500; i += 1) plane[start + i] = 0.9 * (burst[start + i] ?? 0);
    }
    return plane;
  }

  it('turns quiet audio up with gain alone when the peaks allow it', () => {
    const { plan, result } = normalize(stereo(sine(rate, 10, -30)), {
      target: -14,
      ceiling: -1,
      limit: true,
    });
    expect(plan.limited).toBe(false);
    expect(plan.gainDb).toBeCloseTo(16, 1);
    expect(Math.abs(result.integrated + 14)).toBeLessThan(0.1);
    expect(result.truePeak).toBeLessThanOrEqual(-1);
  });

  it('turns loud audio down', () => {
    const { plan, result } = normalize(stereo(sine(rate, 10, -6)), {
      target: -23,
      ceiling: -1,
      limit: true,
    });
    expect(plan.gainDb).toBeCloseTo(-17, 1);
    expect(Math.abs(result.integrated + 23)).toBeLessThan(0.1);
  });

  it(
    'limits the peaks to reach the target: within 0.5 LU, true peak under the ceiling',
    LONG,
    () => {
      const { plan, result } = normalize(stereo(peaky(20)), {
        target: -14,
        ceiling: -1,
        limit: true,
      });
      expect(plan.limited).toBe(true);
      expect(plan.reductionDb).toBeGreaterThan(3);
      expect(Math.abs(result.integrated + 14)).toBeLessThan(0.5);
      expect(result.truePeak).toBeLessThanOrEqual(-1);
      // The prediction is close to what the output measures.
      expect(Math.abs(plan.predicted.integrated - result.integrated)).toBeLessThan(0.2);
    },
  );

  it('with gain only, stops where the peaks reach the ceiling', LONG, () => {
    const { plan, result } = normalize(stereo(peaky(20)), {
      target: -14,
      ceiling: -1,
      limit: false,
    });
    expect(plan.heldBack).toBe(true);
    expect(plan.limited).toBe(false);
    expect(result.truePeak).toBeLessThanOrEqual(-0.99);
    expect(result.truePeak).toBeGreaterThan(-1.1);
    expect(result.integrated).toBeLessThan(-14.5);
  });

  it('the limiter never asks more of a block than its peak needs, and moves smoothly', () => {
    const peaks = new Float32Array(400).fill(0.1);
    peaks[200] = 2;
    const knots = limiterKnots(peaks, 1, 0.5);
    expect(knots[200]).toBeLessThanOrEqual(0.25);
    expect(knots[201]).toBeLessThanOrEqual(0.25);
    // Down over the 5 ms before, back up over about 80 ms after.
    expect(knots[190]).toBe(1);
    expect(knots[196]).toBeLessThan(1);
    expect(knots[260]).toBeLessThan(0.9);
    expect(knots[399]).toBeGreaterThan(0.9);
    for (let k = 1; k < knots.length; k += 1) {
      expect(Math.abs((knots[k] ?? 0) - (knots[k - 1] ?? 0))).toBeLessThan(0.2);
    }
  });

  it('refuses silence', () => {
    expect(() =>
      planNormalize(scan(rate, stereo(new Float32Array(rate)), 4096, true), {
        target: -14,
        ceiling: -1,
        limit: true,
      }),
    ).toThrow(RangeError);
  });
});
