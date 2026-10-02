/**
 * V10 Extract Frames / Thumbnail (tools/video.md): the frame on screen at a
 * time (the In point), a frame every N seconds, N frames evenly spaced, or a
 * contact sheet, from the timeline's selection. Frames are decoded exactly:
 * the one shown at a time, never a neighbour.
 */
import { zipSync } from 'fflate';
import { CanvasSink } from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { safeStem } from '../names';
import { MediaInputError, openInput } from './media';

export interface FramesOptions {
  /** single, interval, count or sheet. */
  mode?: string;
  /** interval: seconds between frames. */
  every?: string;
  /** count: how many frames. */
  count?: string;
  /** sheet: "4x4", columns × rows. */
  grid?: string;
  /** png, jpeg or webp. */
  format?: string;
  /** original, or the width in px. */
  size?: string;
  /** The timeline's selection, seconds. */
  start?: number;
  end?: number;
}

/** Most frames one run makes: a ZIP that size is already a lot to look through. */
export const MAX_FRAMES = 500;

const TYPES: Record<string, { mime: string; ext: string }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

/** "00:01:05.400": the time a frame was taken. */
export function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
}

/** The times to take, for a mode, inside the selection [start, end). */
export function frameTimes(
  opts: Pick<FramesOptions, 'mode' | 'every' | 'count' | 'grid'>,
  start: number,
  end: number,
): number[] {
  const length = Math.max(0, end - start);
  switch (opts.mode) {
    case 'interval': {
      const every = Number(opts.every);
      if (!Number.isFinite(every) || every <= 0) {
        throw new MediaInputError('Set how many seconds apart the frames are.');
      }
      // From the start, every `every` seconds, while still before the end.
      const n = Math.max(1, Math.ceil(length / every - 1e-9));
      if (n > MAX_FRAMES) {
        throw new MediaInputError(
          `That's ${String(n)} frames; ${String(MAX_FRAMES)} is the most at once. Set a longer gap or a shorter selection.`,
        );
      }
      return Array.from({ length: n }, (_, i) => start + i * every);
    }
    case 'count':
    case 'sheet': {
      const n =
        opts.mode === 'sheet'
          ? (opts.grid ?? '4x4')
              .split('x')
              .map(Number)
              .reduce((a, b) => a * b, 1)
          : Number(opts.count);
      if (!Number.isInteger(n) || n < 1 || n > MAX_FRAMES) {
        throw new MediaInputError(`Pick between 1 and ${String(MAX_FRAMES)} frames.`);
      }
      // The middle of each of n equal parts, so the first and last aren't the selection's edges.
      return Array.from({ length: n }, (_, i) => start + (length * (i + 0.5)) / n);
    }
    default:
      return [start];
  }
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, mime: string): Promise<Blob> {
  const quality = mime === 'image/png' ? undefined : 0.92;
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No image'));
      },
      mime,
      quality,
    );
  });
}

/** Columns × rows of thumbnails with a gap around each, the time on each one. */
function sheet(
  frames: { canvas: OffscreenCanvas | HTMLCanvasElement; time: number }[],
  cols: number,
  rows: number,
): OffscreenCanvas {
  const first = frames[0]?.canvas;
  const w = first?.width ?? 1;
  const h = first?.height ?? 1;
  const gap = 8;
  const out = new OffscreenCanvas(cols * w + (cols + 1) * gap, rows * h + (rows + 1) * gap);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, out.width, out.height);
  const size = Math.max(10, Math.round(h / 12));
  ctx.font = `${String(size)}px ui-monospace, monospace`;
  ctx.textBaseline = 'bottom';
  frames.forEach(({ canvas, time }, i) => {
    const x = gap + (i % cols) * (w + gap);
    const y = gap + Math.floor(i / cols) * (h + gap);
    ctx.drawImage(canvas, x, y, w, h);
    const label = stamp(time);
    const pad = Math.round(size / 3);
    const width = ctx.measureText(label).width + pad * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, y + h - size - pad * 2, width, size + pad * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + pad, y + h - pad);
  });
  return out;
}

/** A file name without its extension, safe for the names inside a ZIP. */
function stemOf(name: string): string {
  return safeStem(name, 'video');
}

export const framesEngine: Engine<FramesOptions> = {
  ...MEDIA_META.frames,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const type = TYPES[opts.format ?? 'png'] ?? { mime: 'image/png', ext: 'png' };
    const input = openInput(file);
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new MediaInputError('This file has no video in it.');
      if (!(await track.canDecode())) {
        throw new MediaInputError(
          'This browser can’t decode this video’s frames. Try Chrome, Edge or Safari.',
        );
      }
      // The video's own length: the sound can run a little longer.
      const duration = await track.computeDuration();
      const start = Math.min(Math.max(0, opts.start ?? 0), duration);
      const end = Math.min(duration, Math.max(start, opts.end ?? duration));
      const times = frameTimes(opts, start, end);
      const source = {
        width: await track.getDisplayWidth(),
        height: await track.getDisplayHeight(),
      };
      const wanted = Number(opts.size);
      const sheetMode = opts.mode === 'sheet';
      // A contact sheet's thumbnails are 320 px wide unless the video is smaller.
      const width = sheetMode
        ? Math.min(source.width, 320)
        : Number.isFinite(wanted) && wanted > 0
          ? Math.min(source.width, wanted)
          : source.width;
      const height = Math.max(1, Math.round((source.height * width) / source.width));
      // No pool: every frame gets its own canvas, kept only as long as it takes to encode.
      const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 0 });
      const stem = stemOf(file instanceof File ? file.name : 'video');
      const thumbs: { canvas: OffscreenCanvas | HTMLCanvasElement; time: number }[] = [];
      const files: { name: string; bytes: Uint8Array<ArrayBuffer>; time: number }[] = [];
      let index = 0;
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        if (ctx.signal.aborted) throw new EngineAbortError();
        index += 1;
        ctx.progress(index / times.length, `Frame ${String(index)} of ${String(times.length)}`);
        if (!frame) continue;
        if (sheetMode) {
          thumbs.push({ canvas: frame.canvas, time: frame.timestamp });
        } else {
          files.push({
            name: `${stem}_${stamp(frame.timestamp).replaceAll(':', '-')}.${type.ext}`,
            bytes: new Uint8Array(await (await encode(frame.canvas, type.mime)).arrayBuffer()),
            time: frame.timestamp,
          });
        }
      }
      if (thumbs.length + files.length === 0) {
        throw new MediaInputError('No frames could be read there.');
      }
      if (sheetMode) {
        const [cols = 4, rows = 4] = (opts.grid ?? '4x4').split('x').map(Number);
        const out = sheet(thumbs, cols, rows);
        return {
          blob: await encode(out, type.mime),
          ext: type.ext,
          width: out.width,
          height: out.height,
          nameSuffix: 'sheet',
          path: 'Browser · WebCodecs',
          notes: [
            `${String(thumbs.length)} frames, ${String(cols)} × ${String(rows)}, from ${stamp(thumbs[0]?.time ?? 0)} to ${stamp(thumbs.at(-1)?.time ?? 0)}`,
          ],
          details: [{ label: 'Sheet', value: `${String(out.width)} × ${String(out.height)} px` }],
        };
      }
      const [only] = files;
      if (files.length === 1 && only) {
        return {
          blob: new Blob([only.bytes], { type: type.mime }),
          ext: type.ext,
          width,
          height,
          nameSuffix: stamp(only.time).replaceAll(':', '-'),
          path: 'Browser · WebCodecs',
          notes: [`The frame on screen at ${stamp(start)}: it starts at ${stamp(only.time)}`],
          details: [{ label: 'Frame', value: `${String(width)} × ${String(height)} px` }],
        };
      }
      const zip = zipSync(
        Object.fromEntries(files.map((f) => [f.name, [f.bytes, { level: 0 }] as const])),
      );
      return {
        blob: new Blob([zip.slice().buffer], { type: 'application/zip' }),
        ext: 'zip',
        nameSuffix: 'frames',
        path: 'Browser · WebCodecs',
        notes: [
          `${String(files.length)} frames from ${stamp(files[0]?.time ?? 0)} to ${stamp(files.at(-1)?.time ?? 0)}, each ${String(width)} × ${String(height)} px`,
        ],
        details: [{ label: 'Frames', value: String(files.length) }],
      };
    } finally {
      input.dispose();
    }
  },
};
