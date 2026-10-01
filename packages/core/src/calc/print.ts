/**
 * Print size and DPI (tools/utility.md → U03): pixels ↔ print size at a DPI,
 * the pixels a print needs, and the DPI an image gives at a size. An inch is
 * exactly 25.4 mm. Shared with the panel.
 */

export type Unit = 'cm' | 'mm' | 'in';

const MM_PER: Record<Unit, number> = { cm: 10, mm: 1, in: 25.4 };

export function toInches(value: number, unit: Unit): number {
  return (value * MM_PER[unit]) / 25.4;
}

export function fromInches(inches: number, unit: Unit): number {
  return (inches * 25.4) / MM_PER[unit];
}

/** Print size of `px` pixels at `dpi`, in `unit`. */
export function printSize(px: number, dpi: number, unit: Unit): number {
  return fromInches(px / dpi, unit);
}

/** Pixels a print of `size` (in `unit`) needs at `dpi`, to the nearest pixel (A4 at 300: 2480 × 3508). */
export function pixelsFor(size: number, unit: Unit, dpi: number): number {
  return Math.round(toInches(size, unit) * dpi);
}

/** The DPI `px` pixels give across `size` (in `unit`). */
export function dpiOf(px: number, size: number, unit: Unit): number {
  return px / toInches(size, unit);
}

/** What a DPI is good for, in plain words; judged on the whole DPI, as it's shown. */
export function quality(exact: number): { level: 'print' | 'fair' | 'low'; label: string } {
  const dpi = Math.round(exact);
  if (dpi >= 300) return { level: 'print', label: 'Photo and print quality (300 DPI or more)' };
  if (dpi >= 150) {
    return { level: 'fair', label: 'Fine at arm’s length: posters, large prints (150-299 DPI)' };
  }
  return { level: 'low', label: 'Soft up close; screens or prints seen from afar (under 150 DPI)' };
}

export interface Paper {
  id: string;
  label: string;
  /** Portrait: width ≤ height. */
  width: number;
  height: number;
  unit: Unit;
}

export const PAPERS: readonly Paper[] = [
  { id: 'a6', label: 'A6', width: 105, height: 148, unit: 'mm' },
  { id: 'a5', label: 'A5', width: 148, height: 210, unit: 'mm' },
  { id: 'a4', label: 'A4', width: 210, height: 297, unit: 'mm' },
  { id: 'a3', label: 'A3', width: 297, height: 420, unit: 'mm' },
  { id: 'a2', label: 'A2', width: 420, height: 594, unit: 'mm' },
  { id: 'a1', label: 'A1', width: 594, height: 841, unit: 'mm' },
  { id: 'a0', label: 'A0', width: 841, height: 1189, unit: 'mm' },
  { id: 'letter', label: 'US Letter', width: 8.5, height: 11, unit: 'in' },
  { id: 'legal', label: 'US Legal', width: 8.5, height: 14, unit: 'in' },
  { id: 'tabloid', label: 'Tabloid', width: 11, height: 17, unit: 'in' },
  { id: '4x6', label: 'Photo 4 × 6 in (10 × 15 cm)', width: 4, height: 6, unit: 'in' },
  { id: '5x7', label: 'Photo 5 × 7 in (13 × 18 cm)', width: 5, height: 7, unit: 'in' },
  { id: '8x10', label: 'Photo 8 × 10 in', width: 8, height: 10, unit: 'in' },
  { id: '20x30', label: 'Photo 20 × 30 cm', width: 20, height: 30, unit: 'cm' },
];

/**
 * The largest paper an image fills at `minDpi` or better, turned to match the
 * image (landscape or portrait); null when even the smallest is too big.
 */
export function largestPaper(widthPx: number, heightPx: number, minDpi: number): Paper | null {
  const [shortPx, longPx] = widthPx <= heightPx ? [widthPx, heightPx] : [heightPx, widthPx];
  let best: Paper | null = null;
  let bestArea = 0;
  for (const paper of PAPERS) {
    const fits =
      shortPx >= pixelsFor(paper.width, paper.unit, minDpi) &&
      longPx >= pixelsFor(paper.height, paper.unit, minDpi);
    const area = toInches(paper.width, paper.unit) * toInches(paper.height, paper.unit);
    if (fits && area > bestArea) {
      best = paper;
      bestArea = area;
    }
  }
  return best;
}
