/**
 * Fade curves (tools/audio.md → A07): the gain at a point through a fade,
 * x from 0 (silent) to 1 (full). A fade out runs the same curve backwards.
 */
export const FADE_CURVES = ['linear', 'exponential', 'logarithmic', 's-curve'] as const;

export type FadeCurve = (typeof FADE_CURVES)[number];

/** How sharply the exponential and logarithmic curves bend. */
const K = 4;
const SPAN = Math.exp(K) - 1;

/**
 * - linear: x. Halfway is 0.5 (−6 dB).
 * - exponential: (e^(4x) − 1) / (e^4 − 1). Starts slowly, ends fast; halfway is 0.119 (−18.5 dB).
 * - logarithmic: ln(1 + (e^4 − 1)x) / 4, the exponential's inverse. Rises fast, then eases;
 *   halfway is 0.831 (−1.6 dB).
 * - s-curve: (1 − cos(πx)) / 2. Eases in and out; halfway is 0.5.
 */
export function fadeGain(curve: FadeCurve, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  switch (curve) {
    case 'linear':
      return t;
    case 'exponential':
      return (Math.exp(K * t) - 1) / SPAN;
    case 'logarithmic':
      return Math.log(1 + SPAN * t) / K;
    case 's-curve':
      return (1 - Math.cos(Math.PI * t)) / 2;
  }
}

export const fadeCurveOf = (value: string | undefined): FadeCurve =>
  FADE_CURVES.find((curve) => curve === value) ?? 'linear';

export interface Fades {
  /** Frames the fade in and the fade out last. */
  inFrames: number;
  outFrames: number;
  inCurve: FadeCurve;
  outCurve: FadeCurve;
  /** Frames in the whole file. */
  total: number;
}

/** Applies the fades to planar audio in place; `start` is the first frame's index in the file. */
export function applyFades(planes: Float32Array[], start: number, fades: Fades): void {
  const frames = planes[0]?.length ?? 0;
  const outStart = fades.total - fades.outFrames;
  if (start >= fades.inFrames && start + frames <= outStart) return;
  for (let i = 0; i < frames; i += 1) {
    const n = start + i;
    let gain = 1;
    // A frame's gain is the curve at its centre, so a fade's first frame isn't quite silent
    // and its last isn't quite full: the fade lasts exactly its frames.
    if (n < fades.inFrames) gain *= fadeGain(fades.inCurve, (n + 0.5) / fades.inFrames);
    if (n >= outStart) gain *= fadeGain(fades.outCurve, (fades.total - n - 0.5) / fades.outFrames);
    if (gain === 1) continue;
    for (const plane of planes) plane[i] = (plane[i] ?? 0) * gain;
  }
}
