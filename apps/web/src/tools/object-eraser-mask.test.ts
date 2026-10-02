import type { MaskStroke, StrokeTarget } from '@etb/ui';
import { describe, expect, it } from 'vitest';

import { maskFits } from '../lib/gpu-limits';
import { marksSomething, maskSize, paintMask } from './object-eraser-mask';

describe('the mask’s size', () => {
  it('is the photo’s up to 16 MP, then the same shape at 16 MP', () => {
    expect(maskSize(4000, 3000)).toEqual({ width: 4000, height: 3000, scale: 1 });
    const big = maskSize(8000, 6000);
    expect(big.width * big.height).toBeLessThanOrEqual(16_000_000 + 8000);
    // The GPU function and the jobs API take it as the photo's shape.
    expect(maskFits(big.width, big.height, 8000, 6000)).toBe(true);
    expect(maskFits(maskSize(9999, 37).width, maskSize(9999, 37).height, 9999, 37)).toBe(true);
  });
});

const named = (style: StrokeTarget['fillStyle']) => (typeof style === 'string' ? style : 'pattern');

describe('paintMask', () => {
  it('starts black and paints marks white, unmarks black, scaled to the mask', () => {
    const log: string[] = [];
    const target = {
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      globalAlpha: 0.5,
      globalCompositeOperation: 'copy',
      fillRect: (x: number, y: number, w: number, h: number) => {
        log.push(
          `rect ${named(target.fillStyle)} ${String(x)},${String(y)},${String(w)},${String(h)}`,
        );
      },
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: (x: number, y: number) => log.push(`line ${String(x)},${String(y)}`),
      arc: () => undefined,
      fill: () => log.push(`fill ${named(target.fillStyle)}`),
      stroke: () => log.push(`stroke ${named(target.strokeStyle)} ${String(target.lineWidth)}`),
    } as StrokeTarget & { fillRect: (x: number, y: number, w: number, h: number) => void };
    const strokes: MaskStroke[] = [
      {
        mode: 'mark',
        radius: 20,
        points: [
          [0, 0],
          [200, 100],
        ],
      },
      { mode: 'unmark', radius: 10, points: [[100, 50]] },
    ];
    paintMask(target, strokes, { width: 50, height: 25, scale: 0.25 });
    expect(log).toEqual([
      'rect #000000 0,0,50,25',
      'line 50,25',
      'stroke #ffffff 10',
      'fill #000000',
    ]);
  });

  it('knows when nothing is marked', () => {
    expect(marksSomething([])).toBe(false);
    expect(marksSomething([{ mode: 'unmark', radius: 5, points: [[1, 1]] }])).toBe(false);
    expect(marksSomething([{ mode: 'mark', radius: 5, points: [[1, 1]] }])).toBe(true);
  });
});
