/**
 * Loudness targets the meter checks against (tools/audio.md → A06) and the
 * normaliser's presets come from. Streaming services turn louder audio down
 * to their reference; delivery specs reject audio outside their tolerance.
 */
export interface LoudnessTarget {
  id: string;
  name: string;
  /** LUFS. */
  integrated: number;
  /** LU either side that still passes. */
  tolerance: number;
  /** The highest true peak allowed or recommended, dBTP. */
  truePeak: number;
  /** streaming: played at the reference level. delivery: must be within tolerance. */
  kind: 'streaming' | 'delivery';
}

export const LOUDNESS_TARGETS: readonly LoudnessTarget[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    integrated: -14,
    tolerance: 1,
    truePeak: -1,
    kind: 'streaming',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    integrated: -14,
    tolerance: 1,
    truePeak: -1,
    kind: 'streaming',
  },
  {
    id: 'apple-music',
    name: 'Apple Music',
    integrated: -16,
    tolerance: 1,
    truePeak: -1,
    kind: 'streaming',
  },
  {
    id: 'podcast',
    name: 'Podcasts',
    integrated: -16,
    tolerance: 1,
    truePeak: -1,
    kind: 'delivery',
  },
  {
    id: 'ebu-r128',
    name: 'EBU R128 broadcast',
    integrated: -23,
    tolerance: 0.5,
    truePeak: -1,
    kind: 'delivery',
  },
  {
    id: 'atsc-a85',
    name: 'US TV, ATSC A/85',
    integrated: -24,
    tolerance: 2,
    truePeak: -2,
    kind: 'delivery',
  },
];

const lu = (value: number) => value.toFixed(1);

/** Whether a measurement meets a target, and why not in plain words. */
export function targetVerdict(
  target: LoudnessTarget,
  measured: { integrated: number; truePeak: number },
): { pass: boolean; text: string } {
  const off = measured.integrated - target.integrated;
  const over = measured.truePeak - target.truePeak;
  const problems: string[] = [];
  if (off > target.tolerance) {
    problems.push(
      target.kind === 'streaming'
        ? `${lu(off)} LU too loud, so it plays ${lu(off)} dB quieter`
        : `${lu(off)} LU too loud`,
    );
  } else if (off < -target.tolerance) {
    problems.push(
      target.kind === 'streaming'
        ? `${lu(-off)} LU quieter than the reference`
        : `${lu(-off)} LU too quiet`,
    );
  }
  if (over > 0) problems.push(`true peak ${lu(over)} dB over ${lu(target.truePeak)} dBTP`);
  return problems.length === 0
    ? { pass: true, text: `within ${String(target.tolerance)} LU, true peak under the limit` }
    : { pass: false, text: problems.join('; ') };
}
