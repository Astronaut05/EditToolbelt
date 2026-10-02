import { describe, expect, it } from 'vitest';

import {
  arrowHead,
  arrowShaftEnd,
  centredPoints,
  markBounds,
  markerRadius,
  moveMark,
  nextMarker,
  readableOn,
  resizeMark,
  type Mark,
  type MarkTool,
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

describe('marks from the keyboard', () => {
  const natural = { width: 400, height: 300 };
  const make = (tool: MarkTool, points: Point[], size = 4): Mark => ({
    tool,
    points,
    color: '#ff0000',
    size,
    opacity: 1,
  });

  it('are added in the middle of the image', () => {
    // A box a quarter of the image across, as Blur's "Add box".
    expect(centredPoints('rect', natural)).toEqual([
      [150, 113],
      [250, 188],
    ]);
    expect(centredPoints('marker', natural)).toEqual([[200, 150]]);
    // A line a quarter of the longer side long, left to right through the middle.
    expect(centredPoints('arrow', natural)).toEqual([
      [150, 150],
      [250, 150],
    ]);
    // Along the screen's left to right in a turned photo: here, up the image.
    expect(centredPoints('line', natural, [0, -1])).toEqual([
      [200, 200],
      [200, 100],
    ]);
  });

  it('move together and stay inside the image', () => {
    const arrow = make('arrow', [
      [150, 150],
      [250, 150],
    ]);
    expect(moveMark(arrow, 10, -5, natural).points).toEqual([
      [160, 145],
      [260, 145],
    ]);
    // Stopped at the right edge: the tip lands on it, the shape unchanged.
    expect(moveMark(arrow, 500, 0, natural).points).toEqual([
      [300, 150],
      [400, 150],
    ]);
    const stroke = make('brush', [
      [5, 5],
      [20, 30],
      [40, 10],
    ]);
    expect(moveMark(stroke, -10, -10, natural).points).toEqual([
      [0, 0],
      [15, 25],
      [35, 5],
    ]);
  });

  it('resize by their end, far corner or stroke, inside the image', () => {
    // An arrow's tip moves; its tail stays.
    const arrow = make('arrow', [
      [150, 150],
      [250, 150],
    ]);
    expect(resizeMark(arrow, 10, 0, natural).points).toEqual([
      [150, 150],
      [260, 150],
    ]);
    // A box drawn from its bottom right still grows from its far corner, and never below 2 px.
    const box = make('rect', [
      [250, 188],
      [150, 113],
    ]);
    expect(resizeMark(box, 10, 0, natural).points).toEqual([
      [150, 113],
      [260, 188],
    ]);
    expect(resizeMark(box, -500, 0, natural).points).toEqual([
      [150, 113],
      [152, 188],
    ]);
    expect(resizeMark(box, 500, 500, natural).points).toEqual([
      [150, 113],
      [400, 300],
    ]);
    // A stroke stretches from its top left; a level stroke has no height to stretch.
    const stroke = make('brush', [
      [100, 100],
      [150, 100],
      [200, 100],
    ]);
    expect(resizeMark(stroke, 100, 10, natural).points).toEqual([
      [100, 100],
      [200, 100],
      [300, 100],
    ]);
  });

  it('change a marker’s size by its own step, within the pen’s range', () => {
    const marker = make('marker', [[200, 150]], 4);
    expect(resizeMark(marker, 1, 0, natural, 1, 20).size).toBe(5);
    expect(resizeMark(marker, 0, 1, natural, -4, 20).size).toBe(1);
    expect(resizeMark(make('marker', [[200, 150]], 19), 0, 0, natural, 4, 20).size).toBe(20);
    // Its place doesn't change.
    expect(resizeMark(marker, 1, 0, natural, 1, 20).points).toEqual([[200, 150]]);
  });

  it('are framed with their stroke, arrowhead or circle', () => {
    expect(
      markBounds(
        make('rect', [
          [150, 113],
          [250, 188],
        ]),
      ),
    ).toEqual({ x: 148, y: 111, width: 104, height: 79 });
    // A marker's circle: 5 × the size, at least 14 px.
    expect(markBounds(make('marker', [[200, 150]], 4))).toEqual({
      x: 180,
      y: 130,
      width: 40,
      height: 40,
    });
    // An arrow's head is wider than its line.
    const arrow = markBounds(
      make('arrow', [
        [150, 150],
        [250, 150],
      ]),
    );
    expect(arrow.height).toBeGreaterThan(4);
    expect(markBounds(make('line', []))).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
