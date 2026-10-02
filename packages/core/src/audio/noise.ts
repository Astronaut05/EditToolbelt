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

/** Frequencies the hum check measures: the two mains frequencies, and two either side for the floor. */
const HUM_FREQS = [40, 50, 60, 70] as const;

/**
 * Mains hum, spotted while the page reads the file: the level of 40, 50, 60
 * and 70 Hz in 1 s blocks (Goertzel; a 1 s block is 1 Hz wide, so a mains
 * frequency a little off still lands in its bin), averaged over the blocks.
 */
export class HumMeter {
  private readonly coeffs: number[];
  private readonly block: number;
  private state: { s1: number; s2: number }[];
  private filled = 0;
  private readonly sums: number[];
  private blocks = 0;

  constructor(private readonly rate: number) {
    this.block = Math.max(1, Math.round(rate));
    this.coeffs = HUM_FREQS.map((f) => 2 * Math.cos((2 * Math.PI * f) / rate));
    this.state = HUM_FREQS.map(() => ({ s1: 0, s2: 0 }));
    this.sums = HUM_FREQS.map(() => 0);
  }

  /** Adds mono samples. */
  push(samples: Float32Array): void {
    for (const sample of samples) {
      for (let k = 0; k < this.coeffs.length; k += 1) {
        const state = this.state[k];
        const coeff = this.coeffs[k] ?? 0;
        if (!state) continue;
        const s0 = sample + coeff * state.s1 - state.s2;
        state.s2 = state.s1;
        state.s1 = s0;
      }
      this.filled += 1;
      if (this.filled === this.block) this.close();
    }
  }

  private close(): void {
    this.state.forEach(({ s1, s2 }, k) => {
      const coeff = this.coeffs[k] ?? 0;
      // A sine of amplitude A gives (A · N / 2)²: scaled to the sine's power, A² / 2.
      const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (this.block * this.block);
      this.sums[k] = (this.sums[k] ?? 0) + 2 * power;
    });
    this.state = HUM_FREQS.map(() => ({ s1: 0, s2: 0 }));
    this.filled = 0;
    this.blocks += 1;
  }

  /** dB of each frequency's average power (a full-scale sine is −3 dB), by frequency. */
  result(): Record<number, number> {
    return Object.fromEntries(
      HUM_FREQS.map((f, k) => [
        f,
        this.blocks ? 10 * Math.log10((this.sums[k] ?? 0) / this.blocks + 1e-20) : -Infinity,
      ]),
    );
  }
}

/**
 * Whether the hum check heard mains hum: 50 or 60 Hz at least 10 dB over 40
 * and 70 Hz, 6 dB over the other mains frequency, and louder than −70 dB.
 */
export function humGuess(levels: Record<number, number>): 'off' | '50' | '60' {
  const at = (f: number) => levels[f] ?? -Infinity;
  const floor = Math.max(at(40), at(70));
  for (const [mains, other] of [
    [50, 60],
    [60, 50],
  ] as const) {
    if (at(mains) > -70 && at(mains) - floor >= 10 && at(mains) - at(other) >= 6) {
      return mains === 50 ? '50' : '60';
    }
  }
  return 'off';
}
