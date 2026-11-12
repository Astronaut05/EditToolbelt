import { describe, expect, it } from 'vitest';

import { timedLevels } from './silence';

const RATE = 48_000;
/** `seconds` of a full-scale square wave, in one channel. */
const loud = (seconds: number) => [new Float32Array(Math.round(seconds * RATE)).fill(1)];
const isLoud = (level: number | undefined) => level !== undefined && level > -1;
const isQuiet = (level: number | undefined) => level === -Infinity;

describe('timedLevels (A11, A14, T09: levels on the timeline the cut is made on)', () => {
  it('reads a track that starts late as silence until it starts', () => {
    const timed = timedLevels();
    timed.push(loud(0.5), 0.5, RATE);
    const levels = timed.finish();
    // One level per 10 ms: half a second of silence, then half a second of sound.
    expect(levels).toHaveLength(100);
    expect([...levels.slice(0, 50)].every(isQuiet)).toBe(true);
    expect([...levels.slice(50)].every(isLoud)).toBe(true);
  });

  it('fills a gap between two blocks, however long', () => {
    const timed = timedLevels();
    timed.push(loud(0.2), 0, RATE);
    timed.push(loud(0.2), 1, RATE);
    const levels = timed.finish();
    expect(levels).toHaveLength(120);
    expect([...levels.slice(0, 20)].every(isLoud)).toBe(true);
    expect([...levels.slice(20, 100)].every(isQuiet)).toBe(true);
    expect([...levels.slice(100)].every(isLoud)).toBe(true);
  });

  it('drops what overlaps the block before, and what starts before zero', () => {
    const timed = timedLevels();
    // Encoder delay: the first block starts 20 ms before the track does.
    timed.push(loud(0.12), -0.02, RATE);
    // 50 ms of this one was already read.
    timed.push(loud(0.25), 0.05, RATE);
    expect(timed.finish()).toHaveLength(30);
  });

  it('lays blocks end to end when their times agree to within rounding', () => {
    const timed = timedLevels();
    timed.push(loud(0.1), 0, RATE);
    timed.push(loud(0.1), 0.1 + 1 / RATE, RATE);
    expect(timed.finish()).toHaveLength(20);
  });

  it('is empty for a track with nothing decoded', () => {
    expect(timedLevels().finish()).toHaveLength(0);
  });
});
