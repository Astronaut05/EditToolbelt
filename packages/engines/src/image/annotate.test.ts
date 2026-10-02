import { describe, expect, it } from 'vitest';

import {
  arrowHead,
  arrowShaftEnd,
  markerRadius,
  nextMarker,
  readableOn,
  type Mark,
  type Point,
} from './annotate';

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('arrowHead', () => {
  it('ends at the tip and grows with the stroke width', () => {
    const head = (width: number) => arrowHead([0, 0], [400, 0], width);
    const [tip, left, right] = head(4);
    expect(tip).toEqual([400, 0]);
    // 4 × the width long, its base centred on the line.
    expect(left[0]).toBeCloseTo(384);
    expect(right[0]).toBeCloseTo(384);
    expect(left[1]).toBeCloseTo(-right[1]);
    // Twice the width, twice the head: length and base both scale.
    const thin = head(10);
    const thick = head(20);
    expect(400 - thick[1][0]).toBeCloseTo(2 * (400 - thin[1][0]));
    expect(dist(thick[1], thick[2])).toBeCloseTo(2 * dist(thin[1], thin[2]), 0);
  });

  it('points along the arrow at any angle, and never outgrows a short arrow', () => {
    const [tip, left, right] = arrowHead([10, 10], [10, 110], 5);
    expect(tip).toEqual([10, 110]);
    expect(left[1]).toBeCloseTo(90);
    expect(right[1]).toBeCloseTo(90);
    const short = arrowHead([0, 0], [6, 0], 10);
    expect(short[1][0]).toBeCloseTo(0);
  });

  it('stops the shaft at the head’s base', () => {
    expect(arrowShaftEnd([0, 0], [400, 0], 4)).toEqual([384, 0]);
  });
});

describe('markers', () => {
  it('grow with the size, from 14 px', () => {
    expect(markerRadius(2)).toBe(14);
    expect(markerRadius(6)).toBe(30);
  });

  it('number on from the highest', () => {
    const marker = (n: number): Mark => ({
      tool: 'marker',
      points: [[0, 0]],
      color: '#ff0000',
      size: 4,
      opacity: 1,
      n,
    });
    expect(nextMarker([])).toBe(1);
    expect(nextMarker([marker(1), marker(4)])).toBe(5);
  });

  it('write in black on light colours and white on dark ones', () => {
    expect(readableOn('#ffeb3b')).toBe('#000000');
    expect(readableOn('#1a237e')).toBe('#ffffff');
    expect(readableOn('#c62828')).toBe('#ffffff');
  });
});
