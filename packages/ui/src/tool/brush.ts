/**
 * Brush strokes on a canvas, shared by the Refine brush (P07) and the mask
 * brush (P17): round strokes in image px, drawn the same way on screen and
 * into the full-size result, so what the person paints is what the tool gets.
 * Pure over a canvas context, so tested with a stand-in.
 */

/** A stroke in image px. */
export interface Stroke<Mode extends string = string> {
  mode: Mode;
  radius: number;
  points: [number, number][];
}

/** P17's mask brush: mark paints the area to fill, unmark takes it back. */
export type MaskMode = 'mark' | 'unmark';
export type MaskStroke = Stroke<MaskMode>;
export const MASK_MODES: readonly MaskMode[] = ['mark', 'unmark'];

/** The part of a 2D canvas context the strokes use. */
export interface StrokeTarget {
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
}

/** How a stroke of each mode is drawn: its colour, opacity and how it combines. */
export interface StrokeStyle {
  colour: string;
  alpha?: number;
  composite?: GlobalCompositeOperation;
}

/**
 * Draws ``strokes`` in order, scaled by ``scale`` (image px to target px). A
 * one-point stroke is a dot; others are round-capped, round-joined lines.
 */
export function drawStrokes<Mode extends string>(
  target: StrokeTarget,
  strokes: readonly Stroke<Mode>[],
  styles: Record<Mode, StrokeStyle>,
  scale = 1,
): void {
  target.lineCap = 'round';
  target.lineJoin = 'round';
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    const style = styles[stroke.mode];
    target.globalCompositeOperation = style.composite ?? 'source-over';
    target.globalAlpha = style.alpha ?? 1;
    target.strokeStyle = style.colour;
    target.fillStyle = style.colour;
    target.lineWidth = stroke.radius * 2 * scale;
    target.beginPath();
    if (rest.length === 0) {
      target.arc(first[0] * scale, first[1] * scale, stroke.radius * scale, 0, Math.PI * 2);
      target.fill();
      continue;
    }
    target.moveTo(first[0] * scale, first[1] * scale);
    for (const [x, y] of rest) target.lineTo(x * scale, y * scale);
    target.stroke();
  }
  target.globalCompositeOperation = 'source-over';
  target.globalAlpha = 1;
}

/**
 * Adds a point to a stroke being drawn unless it is within a quarter of the
 * brush of the last one: a long stroke stays a few hundred points, not
 * thousands, and looks the same.
 */
export function addPoint(stroke: Stroke, point: [number, number]): boolean {
  const last = stroke.points.at(-1);
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < Math.max(1, stroke.radius / 4)) {
    return false;
  }
  stroke.points.push(point);
  return true;
}

/** Strokes from an option's JSON, keeping only well-formed ones of the given modes. */
export function parseStrokes<Mode extends string>(
  text: string | undefined,
  modes: readonly Mode[],
): Stroke<Mode>[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown): Stroke<Mode>[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { mode, radius, points } = item as Record<string, unknown>;
    if (!modes.includes(mode as Mode) || typeof radius !== 'number' || !(radius > 0)) return [];
    if (!Array.isArray(points)) return [];
    const kept = points.filter(
      (p: unknown): p is [number, number] =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === 'number' && Number.isFinite(n)),
    );
    return kept.length ? [{ mode: mode as Mode, radius, points: kept }] : [];
  });
}
