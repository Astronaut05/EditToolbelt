/**
 * P11 Watermark Images (tools/photo.md): where a watermark goes on an image
 * of any size. Everything is relative to the image's width, so a batch of
 * different sizes gets the same look: the mark's width, the margin, the
 * spacing of a tiled pattern.
 */

export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';

export const ANCHORS: readonly Anchor[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];

export interface MarkBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  anchor: Anchor;
  /** The mark's width as a share of the image's width (0.15 = 15%). */
  size: number;
  /** The gap from the edges, as a share of the image's width. */
  margin: number;
  /** A nudge from that spot, right and down, as shares of the image's width. */
  offsetX?: number;
  offsetY?: number;
}

/** Column and row of each anchor on the 3 × 3 grid. */
const GRID: Record<Anchor, [number, number]> = {
  tl: [0, 0],
  t: [1, 0],
  tr: [2, 0],
  l: [0, 1],
  c: [1, 1],
  r: [2, 1],
  bl: [0, 2],
  b: [1, 2],
  br: [2, 2],
};

/** Where a position on the grid puts a span inside a length, `gap` from the ends. */
const along = (cell: number, length: number, span: number, gap: number) =>
  cell === 0 ? gap : cell === 2 ? length - gap - span : Math.round((length - span) / 2);

/** The mark's box on an image, from its own aspect ratio (height ÷ width). */
export function markBox(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  { anchor, size, margin, offsetX = 0, offsetY = 0 }: Placement,
): MarkBox {
  const width = Math.max(1, Math.round(imageWidth * size));
  const height = Math.max(1, Math.round(width * aspect));
  const gap = Math.round(imageWidth * margin);
  const [column, row] = GRID[anchor];
  return {
    x: along(column, imageWidth, width, gap) + Math.round(imageWidth * offsetX),
    y: along(row, imageHeight, height, gap) + Math.round(imageWidth * offsetY),
    width,
    height,
  };
}

/**
 * Boxes for a tiled pattern: the mark repeated over the whole image on a
 * grid offset every other row, `spacing` (a share of the image's width)
 * apart, so no edge is left bare.
 */
export function tileBoxes(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  size: number,
  spacing: number,
): MarkBox[] {
  const width = Math.max(1, Math.round(imageWidth * size));
  const height = Math.max(1, Math.round(width * aspect));
  const stepX = width + Math.round(imageWidth * spacing);
  const stepY = height + Math.round(imageWidth * spacing);
  const boxes: MarkBox[] = [];
  for (let row = 0, y = -height / 2; y < imageHeight; row += 1, y += stepY) {
    const shift = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = -width / 2 - shift; x < imageWidth; x += stepX) {
      boxes.push({ x: Math.round(x), y: Math.round(y), width, height });
    }
  }
  return boxes;
}
