import { describe, expect, it } from 'vitest';

import { dbGain, LOOP_FADE, MAX_LOOPS, musicEnd, musicGain, musicParts } from './mix';

describe('musicParts', () => {
  it('plays a longer track once, cut at the video’s end', () => {
    expect(musicParts(60, 5, 20, false)).toEqual([{ from: 5, to: 25, at: 0 }]);
  });

  it('ends a shorter track early unless it loops', () => {
    const once = musicParts(10, 2, 25, false);
    expect(once).toEqual([{ from: 2, to: 10, at: 0 }]);
    expect(musicEnd(once)).toBe(8);
    const looped = musicParts(10, 2, 25, true);
    expect(looped).toEqual([
      { from: 2, to: 10, at: 0 },
      { from: 0, to: 10, at: 8 },
      { from: 0, to: 7, at: 18 },
    ]);
    expect(musicEnd(looped)).toBe(25);
  });

  it('plays nothing from past the music’s end, and stops a runaway loop', () => {
    expect(musicParts(10, 12, 20, true)).toEqual([]);
    expect(musicParts(0.001, 0, 3600, true)).toHaveLength(MAX_LOOPS);
  });
});

describe('musicGain', () => {
  const base = { level: dbGain(-6), fadeIn: 2, fadeOut: 4, end: 20, repeats: [] };

  it('is the level between the fades, and silent after the end', () => {
    expect(musicGain(10, base)).toBeCloseTo(0.501, 3);
    expect(musicGain(20, base)).toBe(0);
    expect(musicGain(25, base)).toBe(0);
  });

  it('ramps in and out linearly', () => {
    expect(musicGain(0, base)).toBe(0);
    expect(musicGain(1, base)).toBeCloseTo(base.level / 2, 6);
    expect(musicGain(18, base)).toBeCloseTo(base.level / 2, 6);
  });

  it('dips to silence where a loop starts again', () => {
    const looped = { ...base, fadeIn: 0, fadeOut: 0, repeats: [8] };
    expect(musicGain(8, looped)).toBe(0);
    expect(musicGain(8 + LOOP_FADE / 2, looped)).toBeCloseTo(looped.level / 2, 6);
    expect(musicGain(8 + LOOP_FADE, looped)).toBeCloseTo(looped.level, 6);
  });
});
