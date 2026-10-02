/**
 * Adding music or a sound to a video (tools/video.md → V14): where each part
 * of it plays under the picture, and its gain at each moment. Pure, so the
 * engine only decodes, mixes and encodes.
 */

/** One stretch of the music: music seconds `from`–`to`, playing from video second `at`. */
export interface MusicPart {
  from: number;
  to: number;
  at: number;
}

/** Most repeats of a loop: a very short sound under a very long video is a mistake. */
export const MAX_LOOPS = 1000;

/** The dip to silence either side of a loop's repeat, seconds: no click where the end meets the start. */
export const LOOP_FADE = 0.01;

/**
 * The music from `offset` on, under a video `length` seconds long: once,
 * ending early if it's shorter, or from its start again each time it ends.
 * It never runs past the video's end.
 */
export function musicParts(
  musicLength: number,
  offset: number,
  length: number,
  loop: boolean,
): MusicPart[] {
  const parts: MusicPart[] = [];
  let from = Math.min(Math.max(0, offset), musicLength);
  let at = 0;
  while (at < length - 1e-9 && parts.length < MAX_LOOPS) {
    const to = Math.min(musicLength, from + (length - at));
    if (to - from <= 1e-9) break;
    parts.push({ from, to, at });
    at += to - from;
    if (!loop) break;
    from = 0;
  }
  return parts;
}

/** Where the music stops: the video's end, or its own end if that comes first. */
export function musicEnd(parts: MusicPart[]): number {
  const last = parts.at(-1);
  return last ? last.at + (last.to - last.from) : 0;
}

export interface MusicGain {
  /** Linear gain: 10^(dB/20). */
  level: number;
  /** Seconds faded in from the video's start, and out to the music's end. */
  fadeIn: number;
  fadeOut: number;
  /** When the music stops (musicEnd). */
  end: number;
  /** Video seconds where a loop starts again, in order. */
  repeats: number[];
}

/** The first repeat at or after `t`, by halving: a 4 s loop under an hour has 900 of them. */
function firstFrom(repeats: number[], t: number): number {
  let lo = 0;
  let hi = repeats.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((repeats[mid] ?? Infinity) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The music's gain at video second `t`. */
export function musicGain(t: number, g: MusicGain): number {
  if (t < 0 || t >= g.end) return 0;
  let gain = g.level;
  if (g.fadeIn > 0 && t < g.fadeIn) gain *= t / g.fadeIn;
  if (g.fadeOut > 0 && t > g.end - g.fadeOut) gain *= (g.end - t) / g.fadeOut;
  // Only the repeats near t can dip it: those within twice the dip either side
  // are checked, in order, exactly as a check of every repeat would.
  for (let i = firstFrom(g.repeats, t - 2 * LOOP_FADE); i < g.repeats.length; i += 1) {
    const at = g.repeats[i] ?? Infinity;
    if (at > t + 2 * LOOP_FADE) break;
    const from = Math.abs(t - at);
    if (from < LOOP_FADE) gain *= from / LOOP_FADE;
  }
  return gain;
}

/** A level in dB as a linear gain. */
export function dbGain(db: number): number {
  return 10 ** (db / 20);
}
