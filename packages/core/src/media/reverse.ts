/**
 * A15 Reverse Audio and V18 Reverse Video: the order a file is read in to
 * play frames backwards a window at a time, so a long file never sits in
 * memory whole, and the dip that keeps a reversed part's joins from clicking.
 */

/**
 * A stretch of frames: read forwards and written as it is, or read and
 * written backwards. `to` null: to the end, however long the decoder finds it.
 */
export interface ReversePiece {
  from: number;
  to: number | null;
  reverse: boolean;
}

/**
 * The pieces, in the order they're written, to reverse frames `start`–`end`
 * (`end` null: to the end of the file) of a file about `total` frames long:
 * what comes before as it is, the selection's windows last to first, then
 * what comes after as it is.
 */
export function reversePieces(
  start: number,
  end: number | null,
  window: number,
  total: number,
): ReversePiece[] {
  if (window <= 0) throw new RangeError('window must be positive');
  const from = Math.max(0, Math.round(start));
  const to = end === null ? null : Math.max(from, Math.round(end));
  const pieces: ReversePiece[] = [];
  if (from > 0) pieces.push({ from: 0, to: from, reverse: false });
  const span = (to ?? Math.max(from, Math.round(total))) - from;
  const windows = Math.max(1, Math.ceil(span / window));
  for (let k = windows - 1; k >= 0; k -= 1) {
    const a = from + k * window;
    const last = k === windows - 1;
    pieces.push({ from: a, to: last ? to : a + window, reverse: true });
  }
  if (to !== null) pieces.push({ from: to, to: null, reverse: false });
  return pieces;
}

/**
 * The gain at output frame `n` near the joins between a reversed part and
 * what's around it: down to silence at each join and back up over `fade`
 * frames either side, so the jump in the waveform doesn't click.
 */
export function joinGain(n: number, joins: readonly number[], fade: number): number {
  let gain = 1;
  for (const join of joins) {
    const distance = Math.abs(n + 0.5 - join);
    if (distance < fade) gain = Math.min(gain, distance / fade);
  }
  return gain;
}
