import { describe, expect, it } from 'vitest';

import { fitInto, heightFor, parseRatio, simplify } from './aspect';

describe('aspect ratio', () => {
  it('simplifies resolutions', () => {
    expect(simplify(1920, 1080)).toMatchObject({ label: '16:9' });
    expect(simplify(1080, 1350)).toMatchObject({ label: '4:5' });
    expect(simplify(2560, 1080)).toMatchObject({ label: '64:27', nearest: '2.39:1' });
    expect(simplify(1998, 1080)).toMatchObject({ label: '37:20', nearest: '1.85:1' });
  });

  it('solves the other side, with even rounding for video', () => {
    expect(heightFor(1920, 2.39)).toBe(803);
    expect(heightFor(1920, 2.39, true)).toBe(804);
    expect(heightFor(1080, 9 / 16)).toBe(1920);
  });

  it('parses ratios', () => {
    expect(parseRatio('16:9')).toBeCloseTo(1.7778, 4);
    expect(parseRatio('2.39:1')).toBe(2.39);
    expect(parseRatio('1.85')).toBe(1.85);
    expect(parseRatio('0:9')).toBeNull();
    expect(parseRatio('abc')).toBeNull();
  });

  it('fits into a box and reports bars', () => {
    expect(fitInto(1920, 804, 1920, 1080)).toEqual({
      width: 1920,
      height: 804,
      bars: 'letterbox',
      barSize: 138,
    });
    expect(fitInto(1080, 1920, 1920, 1080)).toEqual({
      width: 608,
      height: 1080,
      bars: 'pillarbox',
      barSize: 656,
    });
    expect(fitInto(3840, 2160, 1920, 1080).bars).toBe('none');
  });
});
