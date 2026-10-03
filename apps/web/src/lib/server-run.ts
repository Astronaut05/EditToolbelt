/**
 * The server path of a hybrid tool, from the browser (docs/06 → Job
 * lifecycle): upload the parts straight to storage, ask for the server's
 * price, start the job, follow it, and download the result. The ToolShell
 * shows each stage and asks before anything is sent.
 *
 * This module is what a page needs before that: the price, the limits and
 * the estimate. The uploads, the job and the API client are in
 * ./server-jobs, loaded when the page first asks for the account or starts
 * a job (docs/10 → the engine is not in the initial bundle).
 */
import { priceOf } from '@etb/registry/pricing';
import type {
  ServerAccount,
  ServerInfo,
  ServerResult,
  ServerRunContext,
  ShellServer,
} from '@etb/ui';

/** Types the API takes, for files the browser gives no type (MKV on most systems). */
const TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
};

/** The type the API is told for a file: by extension first, as browsers type some files oddly. */
export function uploadType(file: File): string {
  return TYPE_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.type;
}

/** What some tools add to the server path. */
export interface ServerExtras {
  /** The output megapixels a run makes, for tools priced per megapixel (Upscale Image). */
  megapixels?: (width: number, height: number, options: Record<string, string>) => number;
  /**
   * Turns the dropped file into the one to upload, in the browser, after the
   * person has said yes (Auto Subtitles: only the sound of a video).
   */
  prepare?: (file: File, ctx: ServerRunContext) => Promise<File>;
  /**
   * Files the page makes from the dropped one and the settings, each sent as
   * an upload of its own with its id in `option` (Object Eraser: the mask,
   * drawn from the brush strokes).
   */
  derived?: readonly {
    option: string;
    label: string;
    make: (file: File, options: Record<string, string>) => Promise<File>;
  }[];
  /**
   * The option that takes the shell's other files to join, in order, by
   * their upload ids (Merge Videos: `clips`); the first file is the job's
   * own upload.
   */
  joined?: string;
}

/** Credits for a file before the server has checked it; null when that needs more than we know. */
export function estimateCredits(
  rule: ServerInfo['rule'],
  durationSec: number | undefined,
  picture: { width?: number; height?: number } | undefined,
  options: Record<string, string>,
  megapixels?: ServerExtras['megapixels'],
): number | null {
  if (rule.kind === 'perMegapixel') {
    if (!picture?.width || !picture.height) return null;
    const mp = megapixels
      ? megapixels(picture.width, picture.height, options)
      : (picture.width * picture.height) / 1e6;
    return priceOf(rule, { megapixels: mp });
  }
  if (rule.kind === 'perMinute' && durationSec === undefined) return null;
  return priceOf(rule, { durationMs: (durationSec ?? 0) * 1000 });
}

/**
 * The ToolShell's server path for one tool: `toServer` turns the shell's
 * options into the tool's API options (@etb/registry/options). `files` are
 * `file` options whose file goes up as its own upload, its id in their place
 * (Burn Subtitles: `subtitles`). `adds` are the rest (`ServerExtras`), such
 * as the option that takes the files to join (Merge Videos: `clips`).
 */
export function serverPath(
  toolId: string,
  info: ServerInfo,
  toServer: (options: Record<string, string>) => Record<string, unknown>,
  here: string,
  files: readonly { option: string; label: string }[] = [],
  adds: ServerExtras = {},
): ShellServer {
  return {
    price: info.price,
    maxBytes: info.maxBytes,
    signInHref: `/sign-in?next=${encodeURIComponent(here)}`,
    estimate: (durationSec, picture, options = {}) =>
      estimateCredits(info.rule, durationSec, picture, options, adds.megapixels),
    async account(): Promise<ServerAccount | null> {
      const jobs = await import('./server-jobs');
      return jobs.account();
    },
    async run(file, shellOptions, ctx): Promise<ServerResult> {
      const jobs = await import('./server-jobs');
      return jobs.runJob(toolId, toServer, files, adds, file, shellOptions, ctx);
    },
  };
}
