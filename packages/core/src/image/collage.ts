/**
 * P16 Collage Maker (tools/photo.md): where each photo goes. A template is a
 * tree of splits: a box divided across (a row of parts) or down (a column),
 * each part a photo or another split. Spacing is the same everywhere:
 * between the photos and around the edge. Cells come out in whole pixels
 * that tile the canvas exactly, so every gap is the spacing to the pixel.
 */

export const COLLAGE_TEMPLATES = ['grid', 'feature', 'feature-top', 'columns', 'rows'] as const;
export type CollageTemplate = (typeof COLLAGE_TEMPLATES)[number];

export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 9;

/** A photo (its index in the order set), or a split into weighted parts. */
export type Layout =
  number | { dir: 'across' | 'down'; parts: { weight: number; child: Layout }[] };

export interface Cell {
  /** The photo's index in the order set. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const across = (children: Layout[]): Layout => ({
  dir: 'across',
  parts: children.map((child) => ({ weight: 1, child })),
});
const down = (children: Layout[]): Layout => ({
  dir: 'down',
  parts: children.map((child) => ({ weight: 1, child })),
});
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Rows for a grid of `n`: as square as it gets, the fuller rows last (5 is 2 then 3). */
function gridRows(n: number): number[] {
  const rows = Math.round(Math.sqrt(n));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return range(0, rows).map((r) => base + (r >= rows - extra ? 1 : 0));
}

/** The template's tree for `n` photos. */
export function layoutOf(template: CollageTemplate, n: number): Layout {
  if (!Number.isInteger(n) || n < MIN_PHOTOS || n > MAX_PHOTOS) {
    throw new RangeError(`A collage takes ${String(MIN_PHOTOS)} to ${String(MAX_PHOTOS)} photos.`);
  }
  switch (template) {
    case 'columns':
      return across(range(0, n));
    case 'rows':
      return down(range(0, n));
    case 'feature':
      // The first photo large on the left, the rest stacked on the right.
      return {
        dir: 'across',
        parts: [
          { weight: 2, child: 0 },
          { weight: 1, child: down(range(1, n)) },
        ],
      };
    case 'feature-top':
      // The first photo large on top, the rest in a row underneath.
      return {
        dir: 'down',
        parts: [
          { weight: 2, child: 0 },
          { weight: 1, child: across(range(1, n)) },
        ],
      };
    case 'grid': {
      let next = 0;
      return down(
        gridRows(n).map((count) => {
          const row = range(next, next + count);
          next += count;
          return across(row);
        }),
      );
    }
  }
}

/** `total` px shared by weight, in whole pixels that add up exactly. */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  let acc = 0;
  return weights.map((w) => {
    acc += w;
    const end = Math.round((total * acc) / sum);
    const size = end - given;
    given = end;
    return size;
  });
}

/** Each photo's box on a `width` × `height` canvas with `gap` px between and around them. */
export function collageCells(
  template: CollageTemplate,
  n: number,
  width: number,
  height: number,
  gap: number,
): Cell[] {
  const g = Math.max(0, Math.round(gap));
  const cells: Cell[] = [];
  const place = (layout: Layout, x: number, y: number, w: number, h: number) => {
    if (typeof layout === 'number') {
      cells.push({ index: layout, x, y, width: w, height: h });
      return;
    }
    const gaps = g * (layout.parts.length - 1);
    const sizes = share(
      (layout.dir === 'across' ? w : h) - gaps,
      layout.parts.map((p) => p.weight),
    );
    let at = layout.dir === 'across' ? x : y;
    layout.parts.forEach((part, i) => {
      const size = sizes[i] ?? 0;
      if (layout.dir === 'across') place(part.child, at, y, size, h);
      else place(part.child, x, at, w, size);
      at += size + g;
    });
  };
  place(layoutOf(template, n), g, g, width - 2 * g, height - 2 * g);
  if (cells.some((cell) => cell.width < 1 || cell.height < 1)) {
    throw new RangeError(
      'The spacing leaves no room for the photos. Use less spacing or a larger size.',
    );
  }
  return cells.sort((a, b) => a.index - b.index);
}

/** The part of a `sw` × `sh` photo that covers a `cw` × `ch` cell, centred: the rest is cropped. */
export function coverCrop(sw: number, sh: number, cw: number, ch: number) {
  const scale = Math.max(cw / sw, ch / sh);
  const w = cw / scale;
  const h = ch / scale;
  return { x: (sw - w) / 2, y: (sh - h) / 2, width: w, height: h };
}
