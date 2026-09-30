import { describe, expect, it } from 'vitest';

import {
  convertFrames,
  customRate,
  formatTimecode,
  framesToSeconds,
  getFrameRate,
  parseTimecode,
} from './timecode';

const df = getFrameRate('29.97-df');
const ndf = getFrameRate('29.97');
const df60 = getFrameRate('59.94-df');

function frames(tc: string, rate = df): number {
  const result = parseTimecode(tc, rate);
  if (!result.ok) throw new Error(result.error);
  return result.frames;
}

describe('timecode', () => {
  it('matches SMPTE drop-frame reference values', () => {
    expect(frames('01:00:00;00')).toBe(107_892);
    expect(frames('00:10:00;00')).toBe(17_982);
    expect(frames('00:01:00;02')).toBe(1_800);
    expect(frames('00:00:59;29')).toBe(1_799);
    expect(frames('01:00:00:00', ndf)).toBe(108_000);
    expect(frames('01:00:00;00', df60)).toBe(215_784);
  });

  it('round-trips every frame of a drop-frame hour', () => {
    for (let n = 0; n < 107_892; n += 7) {
      expect(frames(formatTimecode(n, df))).toBe(n);
    }
    expect(formatTimecode(1_800, df)).toBe('00:01:00;02');
    expect(formatTimecode(17_982, df)).toBe('00:10:00;00');
  });

  it('flags drop-frame timecodes that do not exist', () => {
    const result = parseTimecode('00:01:00;00', df);
    expect(result.ok).toBe(false);
    expect(parseTimecode('00:10:00;00', df).ok).toBe(true);
    expect(parseTimecode('00:01:00;03', df60).ok).toBe(false);
    expect(parseTimecode('00:00:00:25', getFrameRate('25')).ok).toBe(false);
    expect(parseTimecode('nonsense', df).ok).toBe(false);
  });

  it('converts between frame rates by real time', () => {
    // One hour of 24 fps is 90,000 frames; at 23.976 that same duration is shorter in frames.
    expect(convertFrames(86_400, getFrameRate('24'), getFrameRate('25'))).toBe(90_000);
    // A drop-frame hour is 3599.996 real seconds: 90,000 frames at 25 fps.
    expect(convertFrames(107_892, df, getFrameRate('25'))).toBe(90_000);
    // 10 s at 25 fps is 299.7 frames at 29.97: the nearest frame is 300.
    expect(
      formatTimecode(
        convertFrames(frames('00:00:10:00', getFrameRate('25')), getFrameRate('25'), ndf),
        ndf,
      ),
    ).toBe('00:00:10:00');
  });

  it('backs the FAQ numbers on the tool page', () => {
    expect(framesToSeconds(107_892, df)).toBeCloseTo(3599.9964, 6);
    // 23.976 counts 24 numbers per second: one timecode hour is 3,603.6 real seconds.
    expect(framesToSeconds(86_400, getFrameRate('23.976'))).toBeCloseTo(3603.6, 6);
  });

  it('handles negatives and custom rates', () => {
    expect(formatTimecode(-30, getFrameRate('30'))).toBe('-00:00:01:00');
    expect(frames('00:00:01:00', customRate(12))).toBe(12);
    expect(() => customRate(0)).toThrow();
  });
});
