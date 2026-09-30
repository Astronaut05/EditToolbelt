/**
 * Timecode maths (tools/subtitles-and-time.md → T04), SMPTE 12M drop-frame.
 * Frame counts are integers; real time comes from the actual rate
 * (29.97 = 30000/1001). Drop-frame timecodes use ";" before the frames.
 */

export interface FrameRate {
  id: string;
  label: string;
  /** Frames counted per timecode second (30 for 29.97). */
  nominal: number;
  /** Real frames per second. */
  actual: number;
  dropFrame: boolean;
}

function rate(
  id: string,
  label: string,
  nominal: number,
  actual: number,
  dropFrame = false,
): FrameRate {
  return { id, label, nominal, actual, dropFrame };
}

export const FRAME_RATES: readonly FrameRate[] = [
  rate('23.976', '23.976', 24, 24000 / 1001),
  rate('24', '24', 24, 24),
  rate('25', '25', 25, 25),
  rate('29.97-df', '29.97 DF', 30, 30000 / 1001, true),
  rate('29.97', '29.97 NDF', 30, 30000 / 1001),
  rate('30', '30', 30, 30),
  rate('48', '48', 48, 48),
  rate('50', '50', 50, 50),
  rate('59.94-df', '59.94 DF', 60, 60000 / 1001, true),
  rate('59.94', '59.94 NDF', 60, 60000 / 1001),
  rate('60', '60', 60, 60),
];

export function getFrameRate(id: string): FrameRate {
  const found = FRAME_RATES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown frame rate ${id}`);
  return found;
}

/** A whole-number custom rate (no drop-frame). */
export function customRate(fps: number): FrameRate {
  if (!Number.isFinite(fps) || fps <= 0 || fps > 1000)
    throw new Error('Frame rate must be between 0 and 1000');
  const nominal = Math.round(fps);
  return rate(`custom-${String(fps)}`, String(fps), nominal, fps);
}

/** Frames dropped per minute: 2 at 29.97, 4 at 59.94. */
function dropsPerMinute(fr: FrameRate): number {
  return fr.dropFrame ? Math.round(fr.nominal / 15) : 0;
}

export type TimecodeResult = { ok: true; frames: number } | { ok: false; error: string };

/** "01:00:00;00" or "01:00:00:00" (also 1:0:0:0) → frame count. */
export function parseTimecode(input: string, fr: FrameRate): TimecodeResult {
  const match = /^\s*(-)?(\d{1,3})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,3})\s*$/.exec(input);
  if (!match) return { ok: false, error: 'Use HH:MM:SS:FF, for example 01:00:00:00' };
  const [, sign, hh, mm, ss, ff] = match;
  const [h, m, s, f] = [hh, mm, ss, ff].map(Number) as [number, number, number, number];
  if (m > 59 || s > 59) return { ok: false, error: 'Minutes and seconds go up to 59' };
  if (f >= fr.nominal)
    return { ok: false, error: `Frames go up to ${String(fr.nominal - 1)} at ${fr.label} fps` };
  const drop = dropsPerMinute(fr);
  if (drop && s === 0 && m % 10 !== 0 && f < drop) {
    return {
      ok: false,
      error: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00;${String(f).padStart(2, '0')} doesn’t exist in drop-frame: frames 00-${String(drop - 1).padStart(2, '0')} are skipped at the start of each minute except every tenth`,
    };
  }
  const totalMinutes = h * 60 + m;
  const frames =
    (h * 3600 + m * 60 + s) * fr.nominal +
    f -
    drop * (totalMinutes - Math.floor(totalMinutes / 10));
  return { ok: true, frames: sign ? -frames : frames };
}

export function formatTimecode(frames: number, fr: FrameRate): string {
  const negative = frames < 0;
  let n = Math.abs(Math.round(frames));
  const drop = dropsPerMinute(fr);
  if (drop) {
    const per10Min = Math.round(fr.actual * 600);
    const perMin = fr.nominal * 60 - drop;
    const tens = Math.floor(n / per10Min);
    const rest = n % per10Min;
    n += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMin) : 0);
  }
  const f = n % fr.nominal;
  const totalSeconds = Math.floor(n / fr.nominal);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${negative ? '-' : ''}${pad(h)}:${pad(m)}:${pad(s)}${drop ? ';' : ':'}${pad(f)}`;
}

export function framesToSeconds(frames: number, fr: FrameRate): number {
  return frames / fr.actual;
}

export function secondsToFrames(seconds: number, fr: FrameRate): number {
  return Math.round(seconds * fr.actual);
}

/** The same moment in real time at another frame rate (nearest frame). */
export function convertFrames(frames: number, from: FrameRate, to: FrameRate): number {
  return secondsToFrames(framesToSeconds(frames, from), to);
}

/** "3,723.456 s" style readout helper: h, m, s from seconds. */
export function splitSeconds(total: number): { h: number; m: number; s: number } {
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  return { h: sign * Math.floor(abs / 3600), m: Math.floor(abs / 60) % 60, s: abs % 60 };
}
