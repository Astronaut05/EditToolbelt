import { describe, expect, it } from 'vitest';

import { ChannelStats, channelVerdict, remix } from './channels';

const tone = (n: number, a = 0.5, hz = 440, rate = 48_000) =>
  Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * hz * i) / rate));

function verdict(planes: Float32Array[]) {
  const stats = new ChannelStats();
  for (let i = 0; i < (planes[0]?.length ?? 0); i += 1000) {
    stats.push(planes.map((p) => p.subarray(i, i + 1000)));
  }
  return channelVerdict(stats.result());
}

describe('channel verdicts', () => {
  const n = 48_000;
  it('tells one-sided, dual-mono, inverted and ordinary stereo apart', () => {
    const t = tone(n);
    const silent = new Float32Array(n);
    expect(verdict([t, silent])).toBe('left-only');
    expect(verdict([silent, t])).toBe('right-only');
    expect(verdict([t, t.slice()])).toBe('dual-mono');
    expect(verdict([t, t.map((v) => -v)])).toBe('out-of-phase');
    expect(verdict([t, tone(n, 0.3, 660)])).toBe('stereo');
    expect(verdict([silent, silent])).toBe('silent');
  });

  it('calls a slightly different copy dual-mono, as MP3 leaves it', () => {
    const t = tone(n);
    const noisy = t.map((v, i) => v + 1e-4 * Math.sin(i * 1.7));
    expect(verdict([t, noisy])).toBe('dual-mono');
  });
});

describe('remix', () => {
  const l = Float32Array.from([0.5, -0.25, 1]);
  const r = Float32Array.from([0.1, 0.2, -1]);
  it('sums, picks, copies, swaps, inverts and splits', () => {
    const sum = remix([l, r], 'mono-sum')[0] ?? new Float32Array(0);
    [0.3, -0.025, 0].forEach((v, i) => {
      expect(sum[i]).toBeCloseTo(v, 6);
    });
    expect(remix([l, r], 'mono-left')).toEqual([l]);
    expect(remix([l, r], 'mono-right')).toEqual([r]);
    const [a, b] = remix([l, new Float32Array(3)], 'left-both');
    expect(Array.from(a ?? [])).toEqual(Array.from(b ?? []));
    expect(remix([l, r], 'swap')).toEqual([r, l]);
    expect(Array.from(remix([l, r], 'invert-right')[1] ?? [])).toEqual(Array.from(r, (v) => -v));
    expect(remix([l], 'stereo')).toHaveLength(2);
    expect(remix([l, r], 'split')).toEqual([l, r]);
  });
});
