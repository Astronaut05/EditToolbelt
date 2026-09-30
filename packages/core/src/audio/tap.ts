/**
 * A03's tap tempo: the BPM of taps, from the median gap between the last few
 * (a late or early tap moves a median less than a mean). A pause longer than
 * `RESET_MS` starts a new count.
 */
export const RESET_MS = 2500;
const KEEP = 9;

/** Adds a tap time (ms) to the list, starting over after a pause. */
export function addTap(taps: number[], now: number): number[] {
  const last = taps[taps.length - 1];
  const kept = last !== undefined && now - last <= RESET_MS ? taps : [];
  return [...kept, now].slice(-KEEP);
}

/** BPM from tap times (ms), or null until there are 3 taps. */
export function tapBpm(taps: number[]): number | null {
  if (taps.length < 3) return null;
  const gaps = taps.slice(1).map((t, i) => t - (taps[i] ?? t));
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2
      ? (sorted[Math.floor(mid)] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return median > 0 ? Math.round((60_000 / median) * 10) / 10 : null;
}
