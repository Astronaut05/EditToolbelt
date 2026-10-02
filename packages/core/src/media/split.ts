/**
 * A14 Split Audio: where one file is cut into parts. Equal parts, pieces of a
 * set length, or at the silences between the sound (in the middle of each,
 * so nothing is lost and each part keeps half a pause either side). The
 * parts are the timeline's ranges, so any can be moved before the split.
 */
import type { Span } from './ranges';

/** The timeline holds at most this many ranges; a split makes at most this many parts. */
export const MAX_PARTS = 50;

/** A part shorter than this at the end of "by length" joins the one before, seconds. */
const SLIVER = 0.05;

export class TooManyParts extends RangeError {
  constructor(readonly parts: number) {
    super(`That makes ${String(parts)} parts; a split makes up to ${String(MAX_PARTS)}.`);
  }
}

const checked = (parts: Span[]) => {
  if (parts.length > MAX_PARTS) throw new TooManyParts(parts.length);
  return parts;
};

/** `count` parts of the same length. */
export function equalParts(duration: number, count: number): Span[] {
  const n = Math.max(1, Math.round(count));
  return checked(
    Array.from({ length: n }, (_, i) => ({
      start: (i * duration) / n,
      end: ((i + 1) * duration) / n,
    })),
  );
}

/** Pieces `length` seconds long, the last one what's left (a sliver joins the one before). */
export function pieceParts(duration: number, length: number): Span[] {
  if (!(length > 0)) throw new RangeError('The length must be more than 0 s.');
  const parts: Span[] = [];
  for (let start = 0; start < duration - 1e-9; start += length) {
    parts.push({ start, end: Math.min(duration, start + length) });
    if (parts.length > MAX_PARTS) throw new TooManyParts(Math.ceil(duration / length));
  }
  const last = parts.at(-1);
  if (parts.length > 1 && last && last.end - last.start < SLIVER) {
    parts.pop();
    const before = parts.at(-1);
    if (before) before.end = duration;
  }
  return parts;
}

/**
 * Parts between the silences, split in the middle of each. A silence at the
 * very start or end isn't a split: it stays with the first or last part.
 */
export function silenceParts(duration: number, silences: readonly Span[]): Span[] {
  const cuts = silences
    .filter((s) => s.start > 1e-6 && s.end < duration - 1e-6)
    .map((s) => (s.start + s.end) / 2);
  const edges = [0, ...cuts, duration];
  return checked(edges.slice(1).map((end, i) => ({ start: edges[i] ?? 0, end })));
}
