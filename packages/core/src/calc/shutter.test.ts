import { describe, expect, it } from 'vitest';

import {
  angleFromSpeed,
  flickerSafe,
  frameLocked,
  isFlickerSafe,
  motionLook,
  parseSpeed,
  speedFromAngle,
  speedLabel,
} from './shutter';

describe('shutter angle and speed', () => {
  it('follows the 180° rule: half the frame', () => {
    expect(speedLabel(speedFromAngle(24, 180))).toBe('1/48');
    expect(speedLabel(speedFromAngle(25, 180))).toBe('1/50');
    expect(speedLabel(speedFromAngle(24000 / 1001, 180))).toBe('1/47.95');
    expect(angleFromSpeed(24, 1 / 48)).toBeCloseTo(180);
    expect(angleFromSpeed(24, 1 / 50)).toBeCloseTo(172.8);
    expect(speedLabel(speedFromAngle(1, 360))).toBe('1 s');
  });

  it('reads speeds the ways cameras and people write them', () => {
    expect(parseSpeed('1/48')).toBeCloseTo(1 / 48);
    expect(parseSpeed('48')).toBeCloseTo(1 / 48);
    expect(parseSpeed('0.02')).toBeCloseTo(0.02);
    expect(parseSpeed('1s')).toBe(1);
    expect(parseSpeed('2 s')).toBe(2);
    expect(parseSpeed('1/2 s')).toBe(0.5);
    // Any unit means seconds: "sec", and the double prime cameras show for long exposures.
    expect(parseSpeed('2 sec')).toBe(2);
    expect(parseSpeed('2sec')).toBe(2);
    expect(parseSpeed('2"')).toBe(2);
    expect(parseSpeed('1.5"')).toBe(1.5);
    expect(parseSpeed(' 30 S ')).toBe(30);
    expect(parseSpeed('1/2 sec')).toBe(0.5);
    // Without one, a number over 1 is still the camera's denominator.
    expect(parseSpeed('2')).toBe(0.5);
    expect(parseSpeed('s')).toBeNaN();
    expect(parseSpeed('"')).toBeNaN();
    expect(parseSpeed('')).toBeNaN();
    expect(parseSpeed('fast')).toBeNaN();
    expect(parseSpeed('1/0')).toBeNaN();
  });

  it('says how the motion looks', () => {
    expect(motionLook(45)).toMatch(/staccato/);
    expect(motionLook(180)).toMatch(/film-like/);
    expect(motionLook(270)).toMatch(/more blur/);
  });
});

describe('flicker', () => {
  it('lists whole pulses of the light that fit in a frame', () => {
    // 50 Hz mains pulses 100 times a second: 1/100, 1/50, 3/100, 1/25.
    const at24 = flickerSafe(24, 50);
    expect(at24.map((s) => Number(s.angle.toFixed(1)))).toEqual([86.4, 172.8, 259.2, 345.6]);
    expect(speedLabel(at24[1]?.seconds ?? 0)).toBe('1/50');
    expect(flickerSafe(25, 50).map((s) => Math.round(s.angle))).toEqual([90, 180, 270, 360]);
    expect(flickerSafe(24, 60).map((s) => speedLabel(s.seconds))).toEqual([
      '1/120',
      '1/60',
      '1/40',
      '1/30',
      // A whole frame at 24 fps is exactly 5 pulses.
      '1/24',
    ]);
  });

  it('knows when a speed or a frame rate avoids it', () => {
    expect(isFlickerSafe(1 / 50, 50)).toBe(true);
    expect(isFlickerSafe(1 / 48, 50)).toBe(false);
    expect(isFlickerSafe(1 / 60, 60)).toBe(true);
    expect(isFlickerSafe(1 / 200, 50)).toBe(false);
    expect(frameLocked(25, 50)).toBe(true);
    expect(frameLocked(30, 60)).toBe(true);
    expect(frameLocked(24, 50)).toBe(false);
    expect(frameLocked(30000 / 1001, 60)).toBe(false);
  });
});
