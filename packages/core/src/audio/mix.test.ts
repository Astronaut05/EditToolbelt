import { describe, expect, it } from 'vitest';

import {
  dbGain,
  LOOP_FADE,
  MAX_LOOPS,
  musicEnd,
  musicGain,
  musicParts,
  type MusicGain,
} from './mix';

/** The gain as it was first written: every repeat checked at every sample. */
function everyRepeat(t: number, g: MusicGain): number {
  if (t < 0 || t >= g.end) return 0;
  let gain = g.level;
  if (g.fadeIn > 0 && t < g.fadeIn) gain *= t / g.fadeIn;
  if (g.fadeOut > 0 && t > g.end - g.fadeOut) gain *= (g.end - t) / g.fadeOut;
  for (const at of g.repeats) {
    const from = Math.abs(t - at);
    if (from < LOOP_FADE) gain *= from / LOOP_FADE;
  }
  return gain;
}

/** A sound `loop` seconds long from `offset`, looped under `length` seconds of video. */
function looped(loop: number, offset: number, length: number): MusicGain {
  const parts = musicParts(loop, offset, length, true);
  return {
    level: dbGain(-15),
    fadeIn: 1,
    fadeOut: 2,
    end: musicEnd(parts),
    repeats: parts.slice(1).map((p) => p.at),
  };
}

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

describe('musicGain under a long video', () => {
  const RATE = 48_000;

  it('matches checking every repeat, sample for sample: a 4 s loop under 15 s', () => {
    const g = looped(4, 1.5, 15);
    expect(g.repeats).toHaveLength(4);
    for (let i = 0; i < 15 * RATE; i += 1) {
      const t = i / RATE;
      const gain = musicGain(t, g);
      if (gain !== everyRepeat(t, g)) expect(gain).toBe(everyRepeat(t, g));
    }
  });

  it('matches it around the first, middle and last repeats of a 4 s loop under an hour', () => {
    const g = looped(4, 0, 3600);
    expect(g.repeats).toHaveLength(899);
    const near = [...g.repeats.slice(0, 3), ...g.repeats.slice(448, 451), ...g.repeats.slice(-3)];
    for (const at of near) {
      for (let i = -600; i <= 600; i += 1) {
        const t = at + i / RATE;
        const gain = musicGain(t, g);
        if (gain !== everyRepeat(t, g)) expect(gain).toBe(everyRepeat(t, g));
      }
    }
  });

  it('checks only the repeats nearby: an hour of samples takes no longer than a few repeats', () => {
    const g = looped(4, 0, 3600);
    const started = performance.now();
    let sum = 0;
    for (let i = 0; i < 60 * RATE; i += 1) sum += musicGain(3000 + i / RATE, g);
    expect(sum).toBeGreaterThan(0);
    // A minute at 48 kHz: well under a second (checking all 899 repeats took about 6 s).
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
