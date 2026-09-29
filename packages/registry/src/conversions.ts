/**
 * Conversion pair pages (docs/09 → URL scheme): /convert/<from>-to-<to>.
 *
 * Only real, supported pairs with search demand, as listed in tools/README.md →
 * "Conversion pair pages". Each pair is a preset of the tool in `toolId`, and
 * gets a page only once that tool is live or beta (docs/12 → M2).
 */

export interface ConversionPair {
  /** URL segment under /convert. */
  slug: string;
  from: string;
  to: string;
  /** The converter tool this pair is a preset of. */
  toolId: string;
  wave: 1 | 2 | 3;
}

function pair(from: string, to: string, toolId: string, wave: 1 | 2 | 3 = 1): ConversionPair {
  return { slug: `${from}-to-${to}`, from, to, toolId, wave };
}

export const conversions: readonly ConversionPair[] = [
  // Image: P06
  pair('heic', 'jpg', 'image-converter'),
  pair('heic', 'png', 'image-converter'),
  pair('webp', 'jpg', 'image-converter'),
  pair('webp', 'png', 'image-converter'),
  pair('png', 'jpg', 'image-converter'),
  pair('jpg', 'png', 'image-converter'),
  pair('png', 'webp', 'image-converter'),
  pair('jpg', 'webp', 'image-converter'),
  pair('avif', 'jpg', 'image-converter'),
  pair('jpg', 'avif', 'image-converter'),
  pair('png', 'ico', 'image-converter', 3),
  // Video: V03, V04, V05
  pair('mov', 'mp4', 'video-converter'),
  pair('mkv', 'mp4', 'video-converter'),
  pair('webm', 'mp4', 'video-converter'),
  pair('avi', 'mp4', 'video-converter'),
  pair('mp4', 'webm', 'video-converter'),
  pair('mp4', 'gif', 'video-to-gif'),
  pair('mov', 'gif', 'video-to-gif'),
  pair('gif', 'mp4', 'gif-to-mp4'),
  // Audio: V06, A01
  pair('mp4', 'mp3', 'extract-audio'),
  pair('mov', 'mp3', 'extract-audio'),
  pair('wav', 'mp3', 'audio-converter'),
  pair('mp3', 'wav', 'audio-converter'),
  pair('m4a', 'mp3', 'audio-converter'),
  pair('flac', 'mp3', 'audio-converter'),
  pair('ogg', 'mp3', 'audio-converter'),
  pair('mp3', 'ogg', 'audio-converter'),
  // Subtitles: T01
  pair('srt', 'vtt', 'subtitle-converter'),
  pair('vtt', 'srt', 'subtitle-converter'),
  pair('ass', 'srt', 'subtitle-converter'),
];

/** "MP4 to GIF" */
export function conversionTitle(pair: ConversionPair): string {
  return `${pair.from.toUpperCase()} to ${pair.to.toUpperCase()}`;
}

export function conversionPath(pair: ConversionPair): string {
  return `/convert/${pair.slug}`;
}
