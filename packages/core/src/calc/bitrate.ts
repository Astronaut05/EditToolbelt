/**
 * Bitrate ↔ file size ↔ duration (tools/subtitles-and-time.md → T06).
 * Bitrates in kilobits per second (1 kbps = 1,000 bit/s); sizes in bytes.
 */

/** Size in bytes of `seconds` of video + audio at the given kbps. */
export function fileSize(seconds: number, videoKbps: number, audioKbps = 0): number {
  return ((videoKbps + audioKbps) * 1000 * seconds) / 8;
}

/** Duration in seconds that fits in `bytes` at the given total kbps. */
export function durationFor(bytes: number, videoKbps: number, audioKbps = 0): number {
  const total = videoKbps + audioKbps;
  return total > 0 ? (bytes * 8) / (total * 1000) : 0;
}

/** Video kbps needed to hit a target size, after the audio's share. */
export function videoBitrateFor(bytes: number, seconds: number, audioKbps = 0): number {
  return seconds > 0 ? (bytes * 8) / seconds / 1000 - audioKbps : 0;
}

export const MB = 1_000_000;
export const MIB = 1_048_576;

/** Typical bitrates for reference only: not rules, and codecs vary a lot with content. */
export const TYPICAL_BITRATES: readonly { use: string; codec: string; kbps: number }[] = [
  { use: '1080p30 upload', codec: 'H.264', kbps: 8_000 },
  { use: '1080p60 upload', codec: 'H.264', kbps: 12_000 },
  { use: '4K30 upload', codec: 'H.264', kbps: 35_000 },
  { use: '4K30 upload', codec: 'HEVC', kbps: 20_000 },
  { use: '1080p30 streaming', codec: 'H.264', kbps: 6_000 },
  { use: 'Stereo audio', codec: 'AAC', kbps: 192 },
  { use: 'Podcast voice', codec: 'MP3', kbps: 96 },
];
