/**
 * Shutter angle ↔ shutter speed (tools/subtitles-and-time.md → T07). A 360°
 * shutter is open for the whole frame, 1/fps of a second; 180° for half of
 * it, the "180° rule" that gives film-like motion blur.
 */

/** Exposure time in seconds for an angle at a frame rate. */
export function speedFromAngle(fps: number, angle: number): number {
  return fps > 0 ? angle / (360 * fps) : 0;
}

/** Shutter angle in degrees for an exposure time at a frame rate. */
export function angleFromSpeed(fps: number, seconds: number): number {
  return seconds * 360 * fps;
}

/**
 * A shutter speed as typed: "1/48", "48" (cameras show the denominator),
 * "0.02", "1s" or "1/2 s". Seconds, or NaN.
 */
export function parseSpeed(text: string): number {
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/\s*(?:s|sec|")$/, '');
  if (!clean) return Number.NaN;
  const slash = clean.indexOf('/');
  if (slash !== -1) {
    const top = Number(clean.slice(0, slash));
    const bottom = Number(clean.slice(slash + 1));
    return top > 0 && bottom > 0 ? top / bottom : Number.NaN;
  }
  const value = Number(clean);
  if (!(value > 0)) return Number.NaN;
  // A bare number over 1 is what a camera shows: the denominator.
  return value > 1 && !/s$/.test(text.trim().toLowerCase()) ? 1 / value : value;
}

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

/** "1/48", "1/47.95", or "0.5 s" for exposures of half a second and longer. */
export function speedLabel(seconds: number): string {
  if (!(seconds > 0)) return '';
  if (seconds >= 0.5) return `${trim(seconds, 2)} s`;
  const denominator = 1 / seconds;
  const whole = Math.round(denominator);
  return Math.abs(denominator - whole) < 0.005 ? `1/${String(whole)}` : `1/${trim(denominator, 2)}`;
}

/** Lights on mains power pulse at twice its frequency: 100 times a second on 50 Hz. */
const pulses = (hz: number) => 2 * hz;

/**
 * Whether every frame starts at the same point of the light's pulse (the frame
 * rate divides 100 or 120 evenly): then no shutter speed flickers, though a
 * rolling shutter may still show still bands.
 */
export function frameLocked(fps: number, hz: number): boolean {
  const ratio = pulses(hz) / fps;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

/** Whether an exposure is a whole number of pulses (within 1 %), so each frame sees the same light. */
export function isFlickerSafe(seconds: number, hz: number): boolean {
  const n = seconds * pulses(hz);
  return n >= 0.99 && Math.abs(n - Math.round(n)) <= 0.01 * Math.round(n);
}

export interface SafeSpeed {
  /** Pulses the exposure spans. */
  n: number;
  seconds: number;
  angle: number;
}

/** The flicker-safe speeds that fit in a frame (up to 360°), shortest first. */
export function flickerSafe(fps: number, hz: number): SafeSpeed[] {
  const out: SafeSpeed[] = [];
  if (!(fps > 0) || !(hz > 0)) return out;
  for (let n = 1; n <= 64; n += 1) {
    const seconds = n / pulses(hz);
    const angle = angleFromSpeed(fps, seconds);
    if (angle > 360 + 1e-9) break;
    out.push({ n, seconds, angle });
  }
  return out;
}

/** How motion looks at an angle, in a few words. */
export function motionLook(angle: number): string {
  if (angle < 90) return 'Crisp, staccato motion, as in action and sports scenes';
  if (angle < 160) return 'Sharper than film, with a little blur';
  if (angle <= 200) return 'Natural, film-like motion blur';
  return 'Smooth, dreamy motion with more blur';
}

/** Frame rates editors use, with their exact NTSC values. */
export const FRAME_RATES: readonly { label: string; fps: number }[] = [
  { label: '23.976', fps: 24000 / 1001 },
  { label: '24', fps: 24 },
  { label: '25', fps: 25 },
  { label: '29.97', fps: 30000 / 1001 },
  { label: '30', fps: 30 },
  { label: '50', fps: 50 },
  { label: '59.94', fps: 60000 / 1001 },
  { label: '60', fps: 60 },
  { label: '120', fps: 120 },
];
