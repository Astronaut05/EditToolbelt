/**
 * The crop box logic behind CanvasEditor's crop mode, in whole source pixels
 * of the turned image: dragging, handles, typed sizes, ratio locks, turns.
 * Pure, so it is unit tested without a browser.
 */
import { centredRatio, clampRect, turnedSize, type Rect, type Size } from '@etb/engines';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Everything the editor has changed, applied in this order by the engine. */
export interface Edit {
  /** Clockwise quarter turns. */
  turns: number;
  flip: boolean;
  /** Crop box in turned pixels; null until the image size is known. */
  crop: Rect | null;
}

export const NO_EDIT: Edit = { turns: 0, flip: false, crop: null };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const whole = (rect: Rect, bounds: Size): Rect => clampRect(rect, bounds);

/**
 * The box for a ratio: as large as fits, as close as it can get to the
 * current box's centre. Free keeps the current box.
 */
export function fitBox(bounds: Size, ratio: number | null, current?: Rect | null): Rect {
  if (!ratio) return current ? whole(current, bounds) : { x: 0, y: 0, ...bounds };
  const box = centredRatio(bounds, ratio);
  if (!current) return box;
  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;
  return {
    ...box,
    x: Math.round(clamp(cx - box.width / 2, 0, bounds.width - box.width)),
    y: Math.round(clamp(cy - box.height / 2, 0, bounds.height - box.height)),
  };
}

export function moveBox(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...rect,
    x: Math.round(clamp(rect.x + dx, 0, bounds.width - rect.width)),
    y: Math.round(clamp(rect.y + dy, 0, bounds.height - rect.height)),
  };
}

export function centreBox(rect: Rect, bounds: Size): Rect {
  return {
    ...rect,
    x: Math.floor((bounds.width - rect.width) / 2),
    y: Math.floor((bounds.height - rect.height) / 2),
  };
}

/**
 * Drags a handle by (dx, dy) source pixels from where the drag started. The
 * opposite corner or edge stays put; a locked ratio grows from whichever
 * direction moved further, and never leaves the image.
 */
export function dragHandle(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: Size,
  ratio: number | null,
  min = 1,
): Rect {
  const left = start.x;
  const top = start.y;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

  if (!ratio) {
    const l = sx < 0 ? clamp(left + dx, 0, right - min) : left;
    const r = sx > 0 ? clamp(right + dx, left + min, bounds.width) : right;
    const t = sy < 0 ? clamp(top + dy, 0, bottom - min) : top;
    const b = sy > 0 ? clamp(bottom + dy, top + min, bounds.height) : bottom;
    return whole({ x: l, y: t, width: r - l, height: b - t }, bounds);
  }

  const minW = Math.max(min, min * ratio);
  const cx = left + start.width / 2;
  const cy = top + start.height / 2;
  // Room from the fixed side to the image edge, in width.
  const roomX = sx > 0 ? bounds.width - left : sx < 0 ? right : 2 * Math.min(cx, bounds.width - cx);
  const roomY =
    (sy > 0 ? bounds.height - top : sy < 0 ? bottom : 2 * Math.min(cy, bounds.height - cy)) * ratio;
  const fromX = start.width + sx * dx;
  const fromY = (start.height + sy * dy) * ratio;
  let width: number;
  if (sx && sy)
    width = Math.abs(fromX - start.width) >= Math.abs(fromY - start.width) ? fromX : fromY;
  else width = sx ? fromX : fromY;
  width = clamp(width, minW, Math.min(roomX, roomY));
  const height = width / ratio;
  const x = sx > 0 ? left : sx < 0 ? right - width : cx - width / 2;
  const y = sy > 0 ? top : sy < 0 ? bottom - height : cy - height / 2;
  return whole({ x, y, width, height: Math.round(height) }, bounds);
}

/** A typed width or height; a locked ratio sets the other side. Shrinks to fit. */
export function setBoxSize(
  rect: Rect,
  side: 'width' | 'height',
  value: number,
  bounds: Size,
  ratio: number | null,
): Rect {
  if (!Number.isFinite(value) || value < 1) return rect;
  let width = side === 'width' ? value : ratio ? value * ratio : rect.width;
  let height = side === 'height' ? value : ratio ? value / ratio : rect.height;
  if (ratio) {
    const fit = Math.min(1, bounds.width / width, bounds.height / height);
    width *= fit;
    height *= fit;
  }
  width = clamp(Math.round(width), 1, bounds.width);
  height = clamp(Math.round(height), 1, bounds.height);
  return {
    width,
    height,
    x: clamp(rect.x, 0, bounds.width - width),
    y: clamp(rect.y, 0, bounds.height - height),
  };
}

/** Turns the image a quarter clockwise; the box turns with it. */
export function turnEdit(edit: Edit, natural: Size, ratio: number | null): Edit {
  const before = turnedSize(natural, edit.turns);
  const turns = (edit.turns + 1) % 4;
  const after = turnedSize(natural, turns);
  const turnedBox = edit.crop && {
    x: before.height - (edit.crop.y + edit.crop.height),
    y: edit.crop.x,
    width: edit.crop.height,
    height: edit.crop.width,
  };
  return { ...edit, turns, crop: fitBox(after, ratio, turnedBox) };
}

/** The box as the settings show it: "2400 × 3000 px". */
export function boxLabel(rect: Rect): string {
  return `${String(rect.width)} × ${String(rect.height)} px`;
}
