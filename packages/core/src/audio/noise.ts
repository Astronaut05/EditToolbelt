/**
 * A10 Noise Reduction, the parts the page decides before anything is sent
 * (tools/audio.md → A10): where the free preview starts, and roughly how much
 * a file sends to our servers.
 */

/** The free preview's length, seconds (tools/audio.md → A10: a 10 s snippet). */
export const NOISE_PREVIEW_SECONDS = 10;

/** Windows over which the page measures the file's level, seconds. */
export const LEVEL_WINDOW_SEC = 0.05;

function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return -Infinity;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)));
  return sorted[index] ?? -Infinity;
}

/** Digital silence, as a level: lower than any background. */
const SILENT_DB = -120;

/**
 * Where the preview starts: the stretch whose background is loudest (its
 * quietest tenth, in dB), so the preview shows what the cleaning does, among
 * stretches where someone speaks (their loudest tenth is at least 6 dB over
 * that background). `levels` are dBFS RMS in windows of `windowSec`, from the
 * start of the file; digital silence counts as the quietest background. With
 * nothing like that, the start; a short file, 0. Rounded down to 0.1 s; ties
 * go to the earliest.
 */
export function previewStart(
  levels: readonly number[],
  windowSec: number,
  seconds = NOISE_PREVIEW_SECONDS,
): number {
  const span = Math.round(seconds / windowSec);
  if (levels.length <= span) return 0;
  // A step of a second: precise enough, and cheap on an hour of windows.
  const step = Math.max(1, Math.round(1 / windowSec));
  let best: { at: number; floor: number } | null = null;
  for (let at = 0; at + span <= levels.length; at += step) {
    const sorted = levels
      .slice(at, at + span)
      .map((level) => (Number.isFinite(level) ? level : SILENT_DB))
      .sort((a, b) => a - b);
    const floor = percentile(sorted, 0.1);
    const voice = percentile(sorted, 0.9);
    if (voice - floor < 6) continue;
    if (!best || floor > best.floor + 0.5) best = { at, floor };
  }
  return best ? Math.floor(best.at * windowSec * 10) / 10 : 0;
}

/**
 * The bytes a file's sound comes to as 16-bit FLAC, for the server's size
 * limit: about 60 % of PCM for speech, with room to spare.
 */
export function flacBytes(durationSec: number, sampleRate: number, channels: number): number {
  return Math.ceil(durationSec * sampleRate * channels * 2 * 0.7) + 8192;
}
