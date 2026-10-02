/**
 * P09 Draw on Image (tools/photo.md): annotations as data, in the image's
 * own pixels, and one function that draws them. The editor draws them on
 * screen at its zoom and the image worker at full size with the same code,
 * so what you see is what you download.
 */

import type { Upright } from './upright';

export type MarkTool = 'brush' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'marker';

export const MARK_TOOLS: readonly MarkTool[] = [
  'brush',
  'highlighter',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'marker',
];

export type Point = readonly [number, number];

export interface Mark {
  tool: MarkTool;
  /** Image pixels. A brush keeps every point; the shapes their first and last. */
  points: Point[];
  /** "#rrggbb". */
  color: string;
  /** Stroke width in image pixels; a marker's circle has 5 × this as its radius (at least 14 px). */
  size: number;
  /** 0-1. A highlighter is drawn at its own opacity under a multiply, like ink. */
  opacity: number;
  /** A numbered marker's number. */
  n?: number;
  /** P01: keeps a marker's number upright in a turned or flipped photo. */
  base?: Upright;
}

/** The drawing calls the marks need: a CanvasRenderingContext2D, or OffscreenCanvas's. */
export type Pen = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'arc'
  | 'ellipse'
  | 'rect'
  | 'fillText'
  | 'scale'
  | 'translate'
  | 'rotate'
  | 'quadraticCurveTo'
> & {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

/** A highlighter is this many times wider than the size picked. */
export const HIGHLIGHTER_WIDTH = 4;

/**
 * An arrow's head: a triangle at `to`, its length and width proportional to
 * the stroke width (and never longer than the arrow), so a thick arrow gets
 * a big head and a thin one a small head.
 */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point, Point] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  const head = Math.min(length, Math.max(8, width * 4));
  const half = Math.max(5, width * 2.5) / 2 + width / 2;
  const ux = (x1 - x0) / length;
  const uy = (y1 - y0) / length;
  const bx = x1 - ux * head;
  const by = y1 - uy * head;
  return [
    [x1, y1],
    [bx - uy * half, by + ux * half],
    [bx + uy * half, by - ux * half],
  ];
}

/** Where an arrow's line stops, so its square end doesn't poke out of the head's tip. */
export function arrowShaftEnd(from: Point, to: Point, width: number): Point {
  const [, left, right] = arrowHead(from, to, width);
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

/** A marker's circle: its centre and radius. */
export const markerRadius = (size: number) => Math.max(14, size * 5);

const first = (mark: Mark): Point => mark.points[0] ?? [0, 0];
const last = (mark: Mark): Point => mark.points[mark.points.length - 1] ?? first(mark);

/** Draws one mark. `scale` takes image pixels to the canvas's pixels. */
export function drawMark(pen: Pen, mark: Mark, scale = 1): void {
  pen.save();
  pen.scale(scale, scale);
  pen.globalAlpha = Math.min(1, Math.max(0, mark.opacity));
  pen.strokeStyle = mark.color;
  pen.fillStyle = mark.color;
  pen.lineWidth = mark.size;
  pen.lineCap = 'round';
  pen.lineJoin = 'round';
  const [x0, y0] = first(mark);
  const [x1, y1] = last(mark);
  switch (mark.tool) {
    case 'brush':
    case 'highlighter': {
      if (mark.tool === 'highlighter') {
        pen.lineWidth = mark.size * HIGHLIGHTER_WIDTH;
        pen.lineCap = 'butt';
        pen.globalCompositeOperation = 'multiply';
      }
      pen.beginPath();
      pen.moveTo(x0, y0);
      if (mark.points.length === 1) pen.lineTo(x0 + 0.01, y0);
      // Smooth: through the midpoints, the points themselves as controls.
      for (let i = 1; i < mark.points.length - 1; i += 1) {
        const [cx, cy] = mark.points[i] ?? [x0, y0];
        const [nx, ny] = mark.points[i + 1] ?? [cx, cy];
        pen.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
      }
      if (mark.points.length > 1) pen.lineTo(x1, y1);
      pen.stroke();
      break;
    }
    case 'line':
      pen.beginPath();
      pen.moveTo(x0, y0);
      pen.lineTo(x1, y1);
      pen.stroke();
      break;
    case 'arrow': {
      const end = arrowShaftEnd(first(mark), last(mark), mark.size);
      pen.lineCap = 'butt';
      pen.beginPath();
      pen.moveTo(x0, y0);
      pen.lineTo(end[0], end[1]);
      pen.stroke();
      const [tip, left, right] = arrowHead(first(mark), last(mark), mark.size);
      pen.beginPath();
      pen.moveTo(tip[0], tip[1]);
      pen.lineTo(left[0], left[1]);
      pen.lineTo(right[0], right[1]);
      pen.closePath();
      pen.fill();
      break;
    }
    case 'rect':
      pen.lineJoin = 'miter';
      pen.beginPath();
      pen.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      pen.stroke();
      break;
    case 'ellipse':
      pen.beginPath();
      pen.ellipse(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2,
        Math.abs(y1 - y0) / 2,
        0,
        0,
        Math.PI * 2,
      );
      pen.stroke();
      break;
    case 'marker': {
      const radius = markerRadius(mark.size);
      pen.beginPath();
      pen.arc(x0, y0, radius, 0, Math.PI * 2);
      pen.fill();
      pen.globalAlpha = 1;
      pen.fillStyle = readableOn(mark.color);
      pen.font = `700 ${String(Math.round(radius * 1.15))}px sans-serif`;
      pen.textAlign = 'center';
      pen.textBaseline = 'middle';
      pen.translate(x0, y0);
      if (mark.base) {
        pen.rotate((mark.base.rotation * Math.PI) / 180);
        if (mark.base.mirror) pen.scale(-1, 1);
      }
      pen.fillText(String(mark.n ?? 1), 0, radius * 0.05);
      break;
    }
  }
  pen.restore();
}

export function drawMarks(pen: Pen, marks: readonly Mark[], scale = 1): void {
  for (const mark of marks) drawMark(pen, mark, scale);
}

/** Black or white, whichever reads better on a colour (a marker's number). */
export function readableOn(hex: string): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return '#ffffff';
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/** The next marker's number: one more than the highest so far. */
export const nextMarker = (marks: readonly Mark[]) =>
  marks.reduce((n, mark) => (mark.tool === 'marker' ? Math.max(n, mark.n ?? 0) : n), 0) + 1;
