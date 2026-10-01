/**
 * P14 Split Image into Grid (tools/photo.md): where each tile is. Pure, so
 * the worker and the tests share it.
 */
import type { Rect, Size } from './geometry';

export interface GridSpec {
  rows: number;
  cols: number;
  /**
   * Space left out between tiles, as a share of a tile's width, so a picture
   * lines up across a feed's own gaps (Instagram's profile grid: about 0.025).
   */
  gap: number;
  /**
   * equal: every tile the same size, the leftover pixels (fewer than one per
   * tile) trimmed evenly from the edges. spread: no pixel lost, tiles differ by 1 px at most.
   */
  remainder: 'equal' | 'spread';
  /** rows: left to right, top to bottom. posting: the reverse, for a profile grid (post the last tile first). */
  order: 'rows' | 'posting';
}

export interface Tile extends Rect {
  /** 1-based, as named in the ZIP. */
  row: number;
  col: number;
  /** Position in the chosen order, 1-based. */
  seq: number;
}

export const GRID_LIMITS = { maxTiles: 100, minTileSide: 16 };

export class GridError extends Error {}

/** Starts and lengths along one side. */
function cuts(length: number, count: number, gap: number, remainder: GridSpec['remainder']) {
  const tile = length / (count + (count - 1) * gap);
  const step = tile * (1 + gap);
  if (remainder === 'spread') {
    return Array.from({ length: count }, (_, i) => {
      const start = Math.round(i * step);
      return { start, size: Math.round(i * step + tile) - start };
    });
  }
  const size = Math.floor(tile);
  const space = Math.round(tile * gap);
  const used = count * size + (count - 1) * space;
  const offset = Math.floor((length - used) / 2);
  return Array.from({ length: count }, (_, i) => ({ start: offset + i * (size + space), size }));
}

export function gridTiles(image: Size, spec: GridSpec): Tile[] {
  const rows = Math.trunc(spec.rows);
  const cols = Math.trunc(spec.cols);
  if (!(rows >= 1 && cols >= 1) || rows * cols > GRID_LIMITS.maxTiles) {
    throw new GridError(`Choose 1 to ${String(GRID_LIMITS.maxTiles)} tiles in all.`);
  }
  if (rows * cols === 1) throw new GridError('Choose at least 2 tiles.');
  const gap = Math.min(Math.max(spec.gap, 0), 0.5);
  const across = cuts(image.width, cols, gap, spec.remainder);
  const down = cuts(image.height, rows, gap, spec.remainder);
  const smallest = Math.min(...across.map((c) => c.size), ...down.map((c) => c.size));
  if (smallest < GRID_LIMITS.minTileSide) {
    throw new GridError(
      `Tiles would be under ${String(GRID_LIMITS.minTileSide)} px. Choose fewer rows or columns.`,
    );
  }
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = across[c];
      const y = down[r];
      if (!x || !y) continue;
      tiles.push({
        x: x.start,
        y: y.start,
        width: x.size,
        height: y.size,
        row: r + 1,
        col: c + 1,
        seq: 0,
      });
    }
  }
  const ordered = spec.order === 'posting' ? [...tiles].reverse() : tiles;
  ordered.forEach((tile, index) => {
    tile.seq = index + 1;
  });
  return ordered;
}

/** A tile's file name: `photo_01_r1c1.jpg`; the number keeps the chosen order when sorted. */
export function tileName(stem: string, tile: Tile, total: number, ext: string): string {
  const seq = String(tile.seq).padStart(String(total).length, '0');
  return `${stem}_${seq}_r${String(tile.row)}c${String(tile.col)}.${ext}`;
}
