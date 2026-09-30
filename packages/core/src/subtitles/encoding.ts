/**
 * Encodings (tools/subtitles-and-time.md → shared rules): detect UTF-8,
 * UTF-16 and the two legacy code pages old subtitle files use most,
 * Windows-1251 (Cyrillic) and Windows-1252 (Western). Always write UTF-8.
 */

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251' | 'windows-1252';
export type EncodingChoice = 'auto' | Encoding;

export const ENCODING_LABELS: Record<Encoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1251': 'Windows-1251 (Cyrillic)',
  'windows-1252': 'Windows-1252 (Western)',
};

/** Share of every other byte that is zero: UTF-16 text in Latin script is full of them. */
function zeroShare(bytes: Uint8Array, offset: number): number {
  let zeros = 0;
  let total = 0;
  for (let i = offset; i < Math.min(bytes.length, 4000); i += 2) {
    total += 1;
    if (bytes[i] === 0) zeros += 1;
  }
  return total === 0 ? 0 : zeros / total;
}

export function detectEncoding(bytes: Uint8Array): Encoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (zeroShare(bytes, 1) > 0.3) return 'utf-16le';
  if (zeroShare(bytes, 0) > 0.3) return 'utf-16be';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    // Not UTF-8: a legacy code page. Cyrillic text is mostly bytes 0xC0-0xFF
    // (а-я, А-Я in 1251); Western text has an accented letter here and there.
    let high = 0;
    let latin = 0;
    for (const byte of bytes) {
      if (byte >= 0xc0) high += 1;
      else if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)) latin += 1;
    }
    return high / Math.max(1, high + latin) > 0.3 ? 'windows-1251' : 'windows-1252';
  }
}

export function decodeBytes(
  bytes: Uint8Array,
  choice: EncodingChoice = 'auto',
): { text: string; encoding: Encoding } {
  const encoding = choice === 'auto' ? detectEncoding(bytes) : choice;
  // TextDecoder drops a matching BOM itself.
  return { text: new TextDecoder(encoding).decode(bytes), encoding };
}

/** UTF-8, with a BOM when asked (old players and Excel look for one). */
export function encodeUtf8(text: string, bom = false): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
