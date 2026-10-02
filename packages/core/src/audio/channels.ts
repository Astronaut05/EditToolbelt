/**
 * Audio channel tools (tools/audio.md → A13): what a stereo file's two sides
 * hold, and the remixes that fix them. Pure functions on planar audio.
 */
export const CHANNEL_ACTIONS = [
  'mono-sum',
  'mono-left',
  'mono-right',
  'stereo',
  'left-both',
  'right-both',
  'swap',
  'invert-left',
  'invert-right',
  'split',
] as const;

export type ChannelAction = (typeof CHANNEL_ACTIONS)[number];

export const channelActionOf = (value: string | undefined): ChannelAction =>
  CHANNEL_ACTIONS.find((action) => action === value) ?? 'mono-sum';

/** Whether an action takes a stereo file (true) or a mono one (false). */
export const needsStereo = (action: ChannelAction): boolean => action !== 'stereo';

/** Running sums for telling what the two sides of a stereo file hold. */
export class ChannelStats {
  private left = 0;
  private right = 0;
  private cross = 0;
  private diff = 0;
  frames = 0;

  push(planes: Float32Array[]): void {
    const l = planes[0];
    const r = planes[1] ?? planes[0];
    if (!l || !r) return;
    for (let i = 0; i < l.length; i += 1) {
      const a = l[i] ?? 0;
      const b = r[i] ?? 0;
      this.left += a * a;
      this.right += b * b;
      this.cross += a * b;
      const d = a - b;
      this.diff += d * d;
    }
    this.frames += l.length;
  }

  /** dBFS RMS of each side, and how alike they are: 1 the same, −1 opposite. */
  result(): { leftDb: number; rightDb: number; correlation: number; differenceDb: number } {
    const db = (energy: number) =>
      energy > 0 && this.frames > 0 ? 10 * Math.log10(energy / this.frames) : -Infinity;
    const norm = Math.sqrt(this.left * this.right);
    return {
      leftDb: db(this.left),
      rightDb: db(this.right),
      correlation: norm > 0 ? this.cross / norm : 0,
      differenceDb: db(this.diff),
    };
  }
}

export type ChannelVerdict =
  'silent' | 'left-only' | 'right-only' | 'dual-mono' | 'out-of-phase' | 'stereo';

/** Below this RMS a side is silent, dBFS. */
const SILENT = -70;

/**
 * What a stereo file's sides hold: one side silent (a lav on one input),
 * the same on both (dual-mono, a mono file stored as stereo), one side
 * inverted (summing to mono would cancel), or ordinary stereo.
 */
export function channelVerdict(stats: ReturnType<ChannelStats['result']>): ChannelVerdict {
  const leftSilent = stats.leftDb < SILENT;
  const rightSilent = stats.rightDb < SILENT;
  if (leftSilent && rightSilent) return 'silent';
  if (rightSilent) return 'left-only';
  if (leftSilent) return 'right-only';
  // What differs between the sides is 45 dB under the quieter one: the same signal, give or
  // take what MP3 or AAC encoding leaves.
  if (stats.differenceDb < Math.min(stats.leftDb, stats.rightDb) - 45) return 'dual-mono';
  if (stats.correlation < -0.7) return 'out-of-phase';
  return 'stereo';
}

/** What each verdict means, and the action that fixes it. */
export const VERDICTS: Record<ChannelVerdict, { text: string; fix?: ChannelAction }> = {
  silent: { text: 'Both channels are silent.' },
  'left-only': {
    text: 'The right channel is silent: it plays in one ear.',
    fix: 'left-both',
  },
  'right-only': {
    text: 'The left channel is silent: it plays in one ear.',
    fix: 'right-both',
  },
  'dual-mono': {
    text: 'Both channels are the same: dual-mono. Mono would be half the size, sounding the same.',
    fix: 'mono-left',
  },
  'out-of-phase': {
    text: 'One channel is inverted: summed to mono, the sound would cancel out.',
    fix: 'invert-right',
  },
  stereo: { text: 'Ordinary stereo: the two channels differ.' },
};

/** The channels after an action (split gives left, then right, each as its own mono file). */
export function remix(planes: Float32Array[], action: ChannelAction): Float32Array[] {
  const [l, r = l] = planes;
  if (!l || !r) return planes;
  const neg = (p: Float32Array) => p.map((v) => -v);
  switch (action) {
    case 'mono-sum':
      return [l.map((v, i) => (v + (r[i] ?? 0)) / 2)];
    case 'mono-left':
      return [l];
    case 'mono-right':
      return [r];
    case 'stereo':
      return [l, l.slice()];
    case 'left-both':
      return [l, l.slice()];
    case 'right-both':
      return [r.slice(), r];
    case 'swap':
      return [r, l];
    case 'invert-left':
      return [neg(l), r];
    case 'invert-right':
      return [l, neg(r)];
    case 'split':
      return [l, r];
  }
}
