/**
 * Recording storage (tools/subtitles-and-time.md → T08): hours of footage
 * that fit on a card or drive at a bitrate, and the reverse. Cards and drives
 * are sold in decimal units (1 GB = 1,000,000,000 bytes); bitrates in Mbps
 * (1,000,000 bits a second).
 */

export const GB = 1e9;
export const TB = 1e12;

/** Hours of recording that fit in `bytes` at `mbps`. */
export function hoursOn(bytes: number, mbps: number): number {
  return mbps > 0 && bytes > 0 ? (bytes * 8) / (mbps * 1e6) / 3600 : 0;
}

/** Bytes needed for `hours` at `mbps`. */
export function bytesFor(hours: number, mbps: number): number {
  return hours > 0 && mbps > 0 ? (hours * 3600 * mbps * 1e6) / 8 : 0;
}

/** "22 h 13 min", "45 min", "1 min" (under a minute rounds up to one, never "0 min"). */
export function durationLabel(hours: number): string {
  if (!(hours > 0)) return '0 min';
  const minutes = Math.max(1, Math.floor(hours * 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)} min`;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

/** "1.2 TB", "640 GB", "12.5 GB": decimal, as cards and drives are labelled. */
export function sizeLabel(bytes: number): string {
  if (bytes >= TB) return `${String(Number((bytes / TB).toFixed(2)))} TB`;
  if (bytes >= 100 * GB) return `${String(Math.round(bytes / GB))} GB`;
  return `${String(Number((bytes / GB).toFixed(1)))} GB`;
}

export interface Codec {
  id: string;
  name: string;
  /** Typical total bitrate, Mbps. */
  mbps: number;
}

/**
 * Starting points only: real bitrates depend on the camera, settings and
 * frame rate. ProRes figures are Apple's for 29.97 fps; the rest are what
 * common cameras record.
 */
export const CODECS: readonly Codec[] = [
  { id: 'prores-hq-uhd', name: 'ProRes 422 HQ, UHD 29.97p', mbps: 707 },
  { id: 'prores-uhd', name: 'ProRes 422, UHD 29.97p', mbps: 471 },
  { id: 'prores-hq-hd', name: 'ProRes 422 HQ, 1080 29.97p', mbps: 220 },
  { id: 'prores-hd', name: 'ProRes 422, 1080 29.97p', mbps: 147 },
  { id: 'prores-lt-hd', name: 'ProRes 422 LT, 1080 29.97p', mbps: 102 },
  { id: 'xavc-s-4k', name: 'H.264 4K 30p, mirrorless (XAVC S)', mbps: 100 },
  { id: 'hevc-4k', name: 'H.265 4K 30p, mirrorless', mbps: 100 },
  { id: 'phone-4k', name: 'H.265 4K 30p, phone', mbps: 45 },
  { id: 'phone-hd', name: 'H.264 1080 30p, phone', mbps: 17 },
];
