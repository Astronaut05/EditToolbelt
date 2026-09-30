/**
 * Raw AAC (.aac) is AAC frames, each behind a 7-byte ADTS header. MP4 keeps
 * the same frames with one AudioSpecificConfig instead, so copying AAC out of
 * a video is rewriting that config into a header per frame: no re-encode, and
 * no AAC encoder needed (browsers often lack one).
 */

export interface AacConfig {
  /** Audio object type: 2 is AAC-LC. */
  objectType: number;
  frequencyIndex: number;
  channelConfig: number;
}

/** Reads the fields ADTS needs from an AudioSpecificConfig. */
export function readAacConfig(description: Uint8Array): AacConfig | null {
  if (description.length < 2) return null;
  const bits = ((description[0] ?? 0) << 8) | (description[1] ?? 0);
  const objectType = bits >> 11;
  const frequencyIndex = (bits >> 7) & 0x0f;
  const channelConfig = (bits >> 3) & 0x0f;
  // ADTS can only carry profiles 1-4 and a frequency from the table.
  if (objectType < 1 || objectType > 4 || frequencyIndex > 12 || channelConfig > 7) return null;
  return { objectType, frequencyIndex, channelConfig };
}

export function adtsHeader(config: AacConfig, payloadLength: number): Uint8Array {
  const length = payloadLength + 7;
  return Uint8Array.from([
    0xff,
    0xf1, // MPEG-4, layer 0, no CRC
    ((config.objectType - 1) << 6) | (config.frequencyIndex << 2) | (config.channelConfig >> 2),
    ((config.channelConfig & 3) << 6) | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc, // buffer fullness 0x7FF, one raw data block
  ]);
}

/** Joins AAC frames into an ADTS stream. */
export function toAdts(config: AacConfig, frames: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = frames.reduce((sum, frame) => sum + frame.length + 7, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const frame of frames) {
    out.set(adtsHeader(config, frame.length), at);
    out.set(frame, at + 7);
    at += frame.length + 7;
  }
  return out;
}
