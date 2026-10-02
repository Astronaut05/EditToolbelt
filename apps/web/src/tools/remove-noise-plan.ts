/**
 * A10 Noise Reduction on the page: what goes to our servers and what comes
 * back (tools/audio.md → A10). Kept apart from the view so it can be tested.
 */

const STRENGTHS = new Set(['light', 'medium', 'strong']);
const MAINS = new Set(['off', '50', '60']);
const FORMATS = new Set(['keep', 'wav', 'flac', 'mp3', 'm4a', 'ogg']);

/** The page's settings as the API's options (@etb/registry/options → remove-noise). */
export function serverOptionsFor(options: Record<string, string>): Record<string, unknown> {
  const pick = (value: string | undefined, allowed: Set<string>, fallback: string) =>
    value !== undefined && allowed.has(value) ? value : fallback;
  return {
    strength: pick(options.strength, STRENGTHS, 'medium'),
    dehum: pick(options.dehum, MAINS, 'off'),
    deess: options.deess === 'on',
    format: pick(options.format, FORMATS, 'keep'),
    preview: options.preview === 'on',
  };
}

/**
 * The format to ask our servers for, and whether the result goes back into
 * the video: a video kept as a video gets lossless FLAC back, which the
 * browser encodes once into the video's own codec; audio our servers don't
 * read (AIFF, WebM …) went up as FLAC and comes back as WAV unless another
 * format is picked.
 */
export function soundPlan(
  file: { video: boolean; serverType: { ext: string } | null },
  format: string,
): { format: string; backIntoVideo: boolean } {
  if (format !== 'keep') return { format, backIntoVideo: false };
  if (file.video) return { format: 'flac', backIntoVideo: true };
  return { format: file.serverType ? 'keep' : 'wav', backIntoVideo: false };
}
