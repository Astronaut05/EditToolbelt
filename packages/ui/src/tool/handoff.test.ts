import { describe, expect, it } from 'vitest';

import { accepts, handOff, takeHandoff } from './handoff';

describe('handoff', () => {
  const file = new File(['x'], 'mug-nobg.png', { type: 'image/png' });

  it('gives the file to the tool it was meant for, once', () => {
    handOff(file, 'resize-image', 1000);
    expect(takeHandoff('compress-image', 1000)).toBeNull();
    expect(takeHandoff('resize-image', 2000)).toEqual([file]);
    expect(takeHandoff('resize-image', 2000)).toBeNull();
  });

  it('drops a file that waited too long', () => {
    handOff(file, 'resize-image', 0);
    expect(takeHandoff('resize-image', 60_000)).toBeNull();
  });

  it('hands several files on at once (a share from another app)', () => {
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    handOff([a, b], 'compress-image', 0);
    expect(takeHandoff('compress-image', 10)).toEqual([a, b]);
    handOff([], 'compress-image', 0);
    expect(takeHandoff('compress-image', 10)).toBeNull();
  });

  it('matches types, wildcards and extensions', () => {
    const png = { type: 'image/png', name: 'a.png' };
    expect(accepts(['image/jpeg', 'image/png'], png)).toBe(true);
    expect(accepts(['image/*'], { type: 'image/webp', name: 'a.webp' })).toBe(true);
    expect(accepts(['video/mp4'], png)).toBe(false);
    expect(accepts(undefined, png)).toBe(false);
    expect(accepts(['image/png'], { type: '', name: 'a' })).toBe(false);
    const srt = { type: 'application/x-subrip;charset=utf-8', name: 'film-synced.SRT' };
    expect(accepts(['.srt', '.vtt'], srt)).toBe(true);
    expect(accepts(['application/x-subrip'], srt)).toBe(true);
  });
});
