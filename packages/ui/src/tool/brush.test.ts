import { describe, expect, it } from 'vitest';

import {
  addPoint,
  drawStrokes,
  MASK_MODES,
  parseStrokes,
  type MaskStroke,
  type StrokeTarget,
} from './brush';

const named = (style: StrokeTarget['fillStyle']) => (typeof style === 'string' ? style : 'pattern');

/** A canvas context that records what is drawn. */
function recorder(): StrokeTarget & { log: string[] } {
  const log: string[] = [];
  const target = {
    log,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    lineWidth: 1,
    strokeStyle: '' as StrokeTarget['strokeStyle'],
    fillStyle: '' as StrokeTarget['fillStyle'],
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    beginPath: () => log.push('begin'),
    moveTo: (x: number, y: number) => log.push(`move ${String(x)},${String(y)}`),
    lineTo: (x: number, y: number) => log.push(`line ${String(x)},${String(y)}`),
    arc: (x: number, y: number, r: number) =>
      log.push(`arc ${String(x)},${String(y)} r${String(r)}`),
    fill: () => log.push(`fill ${named(target.fillStyle)} ${target.globalCompositeOperation}`),
    stroke: () =>
      log.push(
        `stroke ${named(target.strokeStyle)} w${String(target.lineWidth)} ${target.globalCompositeOperation} a${String(target.globalAlpha)}`,
      ),
  };
  return target;
}

describe('drawStrokes', () => {
  const strokes: MaskStroke[] = [
    {
      mode: 'mark',
      radius: 10,
      points: [
        [0, 0],
        [100, 0],
      ],
    },
    { mode: 'unmark', radius: 4, points: [[50, 0]] },
  ];
  const styles = {
    mark: { colour: 'white' },
    unmark: { colour: 'black', composite: 'destination-out' as const },
  };

  it('draws marks as round lines and takes unmarked parts back, in order', () => {
    const target = recorder();
    drawStrokes(target, strokes, styles);
    expect(target.lineCap).toBe('round');
    expect(target.log).toEqual([
      'begin',
      'move 0,0',
      'line 100,0',
      'stroke white w20 source-over a1',
      'begin',
      'arc 50,0 r4',
      'fill black destination-out',
    ]);
    // Left as it found it for whatever draws next.
    expect(target.globalCompositeOperation).toBe('source-over');
  });

  it('scales image px to the target, for a mask drawn smaller than the photo', () => {
    const target = recorder();
    drawStrokes(target, strokes, styles, 0.5);
    expect(target.log).toContain('line 50,0');
    expect(target.log).toContain('stroke white w10 source-over a1');
    expect(target.log).toContain('arc 25,0 r2');
  });
});

describe('addPoint', () => {
  it('skips points closer than a quarter of the brush', () => {
    const stroke: MaskStroke = { mode: 'mark', radius: 40, points: [[0, 0]] };
    expect(addPoint(stroke, [5, 5])).toBe(false);
    expect(addPoint(stroke, [10, 0])).toBe(true);
    expect(stroke.points).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });
});

describe('parseStrokes', () => {
  it('keeps well-formed strokes of the given modes only', () => {
    const text = JSON.stringify([
      { mode: 'mark', radius: 5, points: [[1, 2]] },
      { mode: 'keep', radius: 5, points: [[1, 2]] },
      { mode: 'unmark', radius: 0, points: [[1, 2]] },
      {
        mode: 'unmark',
        radius: 3,
        points: [
          [1, 'x'],
          [3, 4],
        ],
      },
      'nonsense',
    ]);
    expect(parseStrokes(text, MASK_MODES)).toEqual([
      { mode: 'mark', radius: 5, points: [[1, 2]] },
      { mode: 'unmark', radius: 3, points: [[3, 4]] },
    ]);
    expect(parseStrokes('{', MASK_MODES)).toEqual([]);
    expect(parseStrokes(undefined, MASK_MODES)).toEqual([]);
  });
});
