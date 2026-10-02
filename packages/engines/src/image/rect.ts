/**
 * Rectangle and size helpers for the crop box. They sit apart from the pixel
 * code in ./geometry, which re-exports them: the ToolShell's editor state
 * uses them, so every tool page loads this module, and only the image
 * worker needs the pixel code (docs/decisions/2026-10-02-tool-pages-under-script-budget.md).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export function turnedSize(size: Size, turns = 0): Size {
  return turns % 2 === 0 ? size : { width: size.height, height: size.width };
}

/** Keeps a rectangle inside the image, in whole pixels, at least 1 × 1. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.width - 1);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.height - 1);
  const width = Math.min(Math.max(1, Math.round(rect.width)), bounds.width - x);
  const height = Math.min(Math.max(1, Math.round(rect.height)), bounds.height - y);
  return { x, y, width, height };
}

/** The largest rectangle of a width/height ratio that fits, centred. */
export function centredRatio(bounds: Size, ratio: number): Rect {
  let width = bounds.width;
  let height = Math.round(width / ratio);
  if (height > bounds.height) {
    height = bounds.height;
    width = Math.round(height * ratio);
  }
  width = Math.min(Math.max(1, width), bounds.width);
  height = Math.min(Math.max(1, height), bounds.height);
  return {
    x: Math.floor((bounds.width - width) / 2),
    y: Math.floor((bounds.height - height) / 2),
    width,
    height,
  };
}

/** A crop ratio from the options: width / height, or null for Free. */
export function ratioValue(ratio?: string, customW?: string, customH?: string): number | null {
  const parts = ratio === 'custom' ? [customW, customH] : (ratio ?? '').split(':');
  const [w, h] = parts.map(Number);
  return w && h && w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : null;
}
