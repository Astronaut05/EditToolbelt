import { describe, expect, it } from 'vitest';

import {
  BOX_PADDING,
  cssFont,
  drawTextLayer,
  hitsLayer,
  layerFrame,
  LINE_HEIGHT,
  measureText,
  snapCentre,
  type TextLayer,
  type TextPen,
} from './text-layer';

/** A pen that measures every character as half the font size wide, and writes down what it draws. */
function fakePen() {
  const calls: string[] = [];
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(pen.font)?.[1] ?? 10);
  const pen: TextPen = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate ${String(x)} ${String(y)}`),
    rotate: (a: number) => calls.push(`rotate ${a.toFixed(3)}`),
    scale: (x: number) => calls.push(`scale ${String(x)}`),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`box ${String(x)} ${String(y)} ${String(w)} ${String(h)}`),
    fillText: (text: string, x: number, y: number) =>
      calls.push(`fill "${text}" ${String(x)} ${String(y)} ${pen.textAlign}`),
    strokeText: (text: string, x: number, y: number) =>
      calls.push(`stroke "${text}" ${String(x)} ${String(y)} ${String(pen.lineWidth)}`),
    measureText: (text: string) => ({ width: text.length * px() * 0.5 }) as TextMetrics,
  };
  return { pen, calls };
}

const layer = (change: Partial<TextLayer> = {}): TextLayer => ({
  id: 'a',
  text: 'Hello\nWorld!',
  font: 'onest',
  bold: true,
  size: 80,
  color: '#ffffff',
  align: 'center',
  x: 400,
  y: 300,
  rotation: 0,
  stroke: 0,
  strokeColor: '#000000',
  shadow: false,
  box: false,
  boxColor: '#000000',
  boxOpacity: 0.5,
  ...change,
});

describe('text layout', () => {
  it('measures each line and stacks them at the line height', () => {
    const { pen } = fakePen();
    const block = measureText(pen, layer());
    expect(block.lines.map((line) => line.width)).toEqual([200, 240]);
    expect(block.width).toBe(240);
    expect(block.height).toBe(2 * 80 * LINE_HEIGHT);
    expect(layerFrame(block, layer({ box: true }))).toEqual({
      width: 240 + 2 * 80 * BOX_PADDING,
      height: 200 + 2 * 80 * BOX_PADDING,
    });
  });

  it('centres a multi-line block on its point, line by line', () => {
    const { pen, calls } = fakePen();
    drawTextLayer(pen, layer());
    // 2 lines of 100 px: the first centred 50 px above the point, the second 50 below.
    expect(calls).toContain('translate 400 300');
    expect(calls).toContain('fill "Hello" 0 -50 center');
    expect(calls).toContain('fill "World!" 0 50 center');
  });

  it('aligns left and right within the block', () => {
    const left = fakePen();
    drawTextLayer(left.pen, layer({ align: 'left' }));
    expect(left.calls).toContain('fill "Hello" -120 -50 left');
    const right = fakePen();
    drawTextLayer(right.pen, layer({ align: 'right' }));
    expect(right.calls).toContain('fill "World!" 120 50 right');
  });

  it('draws the box first, the outline under the fill, at the export’s scale', () => {
    const { pen, calls } = fakePen();
    drawTextLayer(pen, layer({ text: 'Hi', box: true, stroke: 6 }), 0.5);
    expect(calls[1]).toBe('scale 0.5');
    const box = calls.findIndex((c) => c.startsWith('box'));
    const stroke = calls.findIndex((c) => c.startsWith('stroke'));
    const fill = calls.findIndex((c) => c.startsWith('fill'));
    expect(box).toBeLessThan(stroke);
    expect(stroke).toBeLessThan(fill);
    expect(calls[stroke]).toBe('stroke "Hi" 0 0 12');
  });

  it('draws nothing for empty text', () => {
    const { pen, calls } = fakePen();
    drawTextLayer(pen, layer({ text: '  ' }));
    expect(calls).toEqual([]);
  });

  it('builds the CSS font with a fallback stack', () => {
    expect(cssFont({ font: 'oswald', bold: false }, 40)).toBe(
      '400 40px "etb-text-oswald", "etb-text-onest", sans-serif',
    );
    expect(cssFont({ font: 'user:etb-user-My-Font', bold: true }, 12)).toContain(
      '700 12px "etb-user-My-Font"',
    );
  });
});

describe('placing layers', () => {
  it('hits a layer inside its frame, its rotation undone', () => {
    const { pen } = fakePen();
    const turned = layer({ text: 'Hello', rotation: 90 });
    const block = measureText(pen, turned);
    // 200 × 100, turned upright: tall and thin around (400, 300).
    expect(hitsLayer(block, turned, 400, 210)).toBe(true);
    expect(hitsLayer(block, turned, 510, 300)).toBe(false);
    expect(hitsLayer(block, layer({ text: 'Hello' }), 510, 300)).toBe(true);
  });

  it('snaps to the middle lines within reach, and only then', () => {
    expect(snapCentre(405, 100, 800, 600, 8)).toEqual({
      x: 400,
      y: 100,
      snappedX: true,
      snappedY: false,
    });
    expect(snapCentre(420, 295, 800, 600, 8)).toEqual({
      x: 420,
      y: 300,
      snappedX: false,
      snappedY: true,
    });
  });
});
