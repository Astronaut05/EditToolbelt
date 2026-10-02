import { describe, expect, it } from 'vitest';

import { autoThreshold, cutsCsv, findSilences, LevelScan, silenceCuts } from './silence';

const RATE = 48_000;

/** Speech-like: a tone with pauses of near silence (-80 dBFS hiss) at known times. */
function talk(parts: [number, boolean][], rate = RATE): Float32Array {
  const total = parts.reduce((s, [secs]) => s + secs, 0);
  const out = new Float32Array(Math.round(total * rate));
  let at = 0;
  let seed = 1;
  for (const [secs, loud] of parts) {
    const n = Math.round(secs * rate);
    for (let i = 0; i < n; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const hiss = ((seed / 4294967296) * 2 - 1) * 1e-4;
      out[at + i] = loud ? 0.3 * Math.sin((2 * Math.PI * 220 * (at + i)) / rate) + hiss : hiss;
    }
    at += n;
  }
  return out;
}

function levels(plane: Float32Array, rate = RATE) {
  const scan = new LevelScan(rate, 1);
  for (let i = 0; i < plane.length; i += 1000) scan.push([plane.subarray(i, i + 1000)]);
  return scan.finish();
}

describe('silence detection', () => {
  // Pauses at 2.00-2.80, 4.30-5.50 and 6.50-6.70 (too short to count).
  const plane = talk([
    [2, true],
    [0.8, false],
    [1.5, true],
    [1.2, false],
    [1, true],
    [0.2, false],
    [1.3, true],
  ]);
  const found = findSilences(levels(plane), -50, 0.5);

  it('finds the pauses within 20 ms, and skips those under the minimum', () => {
    expect(found).toHaveLength(2);
    const [a, b] = found;
    expect(Math.abs((a?.start ?? 0) - 2)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((a?.end ?? 0) - 2.8)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((b?.start ?? 0) - 4.3)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((b?.end ?? 0) - 5.5)).toBeLessThanOrEqual(0.02);
  });

  it('sets the automatic threshold above the noise floor', () => {
    // Hiss at about -84 dBFS RMS: 10 dB above, clamped to -60.
    expect(autoThreshold(levels(plane))).toBe(-60);
    const louder = talk([
      [1, true],
      [1, false],
    ]).map((v) => v + 0.003 * Math.sin(v * 1e6));
    expect(autoThreshold(levels(louder))).toBeGreaterThan(-60);
  });

  it('cuts the silence less the padding, or all but a short pause', () => {
    const cuts = silenceCuts(found, 8, { mode: 'remove', padding: 0.1, keep: 0 });
    expect(cuts[0]?.start).toBeCloseTo((found[0]?.start ?? 0) + 0.1, 6);
    expect(cuts[0]?.end).toBeCloseTo((found[0]?.end ?? 0) - 0.1, 6);
    const short = silenceCuts(found, 8, { mode: 'shorten', padding: 0, keep: 0.3 });
    expect(
      (found[1]?.end ?? 0) -
        (found[1]?.start ?? 0) -
        ((short[1]?.end ?? 0) - (short[1]?.start ?? 0)),
    ).toBeCloseTo(0.3, 6);
  });

  it('cuts silence at the very start and end to the edge', () => {
    const cuts = silenceCuts(
      [
        { start: 0, end: 1 },
        { start: 9, end: 10 },
      ],
      10,
      { mode: 'remove', padding: 0.2, keep: 0 },
    );
    expect(cuts).toEqual([
      { start: 0, end: 0.8 },
      { start: 9.2, end: 10 },
    ]);
  });

  // 22.05 and 11.025 kHz don't split into whole 10 ms windows (220.5 and 110.25
  // samples): the windows follow the samples' own times, so nothing drifts.
  it.each([22_050, 11_025])('keeps time at %i Hz: a pause near the end of 10 minutes', (rate) => {
    const plane = talk(
      [
        [590, true],
        [5, false],
        [5, true],
      ],
      rate,
    );
    const scanned = levels(plane, rate);
    expect(scanned.length).toBe(Math.ceil((plane.length / rate) * 100));
    const [pause, ...rest] = findSilences(scanned, -50, 0.5);
    expect(rest).toEqual([]);
    expect(Math.abs((pause?.start ?? 0) - 590)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((pause?.end ?? 0) - 595)).toBeLessThanOrEqual(0.02);
  });

  it('writes the cut list', () => {
    expect(cutsCsv([{ start: 62.5, end: 63.25 }])).toBe(
      'cut,start,end,length_s,start_s,end_s\n1,00:01:02.500,00:01:03.250,0.750,62.500,63.250\n',
    );
  });
});
