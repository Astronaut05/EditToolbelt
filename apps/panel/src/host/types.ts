/**
 * What the panel needs from where it runs. Premiere (./premiere.ts) gives the
 * selected clip and takes results into a project bin; a browser
 * (./browser.ts) stands in while working on the panel and in its tests, with
 * a file picker and downloads.
 */

/** A file to send: read in pieces, so a long clip isn't held in memory twice. */
export interface PickedFile {
  name: string;
  size: number;
  /** The MIME type, as well as the host can tell. */
  type: string;
  slice(start: number, end: number): Promise<Blob>;
  /** The whole file, for the small ones read in the panel (subtitles, LUTs). */
  text(): Promise<string>;
}

export interface Host {
  kind: 'premiere' | 'browser';
  /** The clip selected on the timeline, as its media file; null when nothing is selected. */
  selectedMedia(): Promise<PickedFile | null>;
  /** A file the user picks, by extensions without the dot ("srt"). Null if they cancel. */
  pickFile(extensions: string[]): Promise<PickedFile | null>;
  /**
   * Puts a result in the project: Premiere imports it into the "EditToolbelt"
   * bin, a browser downloads it. Answers what happened, in words.
   */
  importResult(data: Blob, name: string): Promise<string>;
  /** A file the project can't take (a LUT): saved where the user picks. Null if they cancel. */
  saveFile(data: Blob, name: string): Promise<string | null>;
  /** Opens a page in the user's browser. */
  openUrl(url: string): Promise<void>;
  /** The panel's API key, kept in the host's secure storage. */
  readSecret(key: string): Promise<string | null>;
  writeSecret(key: string, value: string | null): Promise<void>;
}

/** MIME types for the extensions the tools take, where the host can't say. */
const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mxf: 'application/mxf',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  cube: 'text/plain',
  '3dl': 'text/plain',
};

export function typeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}
