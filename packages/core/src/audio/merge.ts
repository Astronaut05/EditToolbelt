/**
 * Merging audio files (tools/audio.md → A04 Merge Audio): where each one
 * lands on the result's timeline, and its gain through a crossfade. All in
 * frames at the result's rate. Pure, so the engine only decodes, adds up
 * and encodes.
 */

/** One file on the timeline: from frame `at`, `length` frames, faded in and out over that many frames. */
export interface Placement {
  at: number;
  length: number;
  fadeIn: number;
  fadeOut: number;
}

export type JoinKind = 'cut' | 'crossfade' | 'gap';

/**
 * Files end to end: straight after each other (cut), overlapping by
 * `joinFrames` with an equal-power crossfade, or with `joinFrames` of
 * silence between. A crossfade can be at most half the shortest file, so
 * no more than two ever overlap.
 */
export function placeJoined(lengths: number[], join: JoinKind, joinFrames: number): Placement[] {
  const overlap = join === 'crossfade' ? joinFrames : 0;
  const gap = join === 'gap' ? joinFrames : 0;
  if (overlap > 0 && lengths.some((length) => overlap * 2 > length)) {
    throw new RangeError('A crossfade can be at most half the shortest file');
  }
  const out: Placement[] = [];
  let at = 0;
  lengths.forEach((length, i) => {
    out.push({
      at,
      length,
      fadeIn: i > 0 ? overlap : 0,
      fadeOut: i < lengths.length - 1 ? overlap : 0,
    });
    at += length - overlap + gap;
  });
  return out;
}

/** Files on top of each other, all from the start. */
export function placeMixed(lengths: number[]): Placement[] {
  return lengths.map((length) => ({ at: 0, length, fadeIn: 0, fadeOut: 0 }));
}

/** The result's length in frames. */
export function placedLength(placements: Placement[]): number {
  return placements.reduce((end, p) => Math.max(end, p.at + p.length), 0);
}

/**
 * The gain of a file's frame `k` (0 is its first): 1, or an equal-power
 * curve through a crossfade, where the frame fading out and the one fading
 * in have squared gains that add up to exactly 1.
 */
export function placedGain(p: Placement, k: number): number {
  let gain = 1;
  if (k < p.fadeIn) gain *= Math.sin((Math.PI / 2) * ((k + 0.5) / p.fadeIn));
  const left = p.length - k;
  if (left <= p.fadeOut) gain *= Math.sin((Math.PI / 2) * ((left - 0.5) / p.fadeOut));
  return gain;
}
