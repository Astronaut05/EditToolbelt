/**
 * V05 GIF to MP4 (tools/video.md): the GIF's frames, composed as a browser
 * shows them, become video frames at the GIF's own times (a 30 ms frame
 * stays 30 ms, a 2 s pause stays 2 s), so the video plays exactly like the
 * GIF. Transparent pixels get a background colour, since MP4 has no alpha.
 * H.264 in MP4 where the browser encodes it, else VP9 in WebM.
 */
import {
  BufferTarget,
  canEncodeVideo,
  EncodedPacketSink,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput } from '../types';
import { GifReadError, gifFrames, readGif } from './gif/decode';
import { MediaInputError, openInput } from './media';

export interface GifToVideoOptions {
  /** mp4 or webm */
  format?: string;
  /** How many times the animation plays in the video. */
  plays?: string;
  /** Fill for transparent pixels, #rrggbb. */
  background?: string;
}

export const GIF_INPUT_LIMITS = {
  maxBytes: 200 * 1024 ** 2,
  maxPixels: 4096 * 4096,
  maxSeconds: 10 * 60,
};

/** "#1a2b3c" → [26, 43, 60]; anything else is white. */
export function parseColour(hex: string | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m?.[1]) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Video encoders want even sizes: one row or column of background makes up the difference. */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: width + (width % 2), height: height + (height % 2) };
}

/** The GIF frame over the background, into an even-sized RGBA buffer. */
export function flatten(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  into: Uint8Array,
  outWidth: number,
  background: [number, number, number],
): void {
  const [r, g, b] = background;
  for (let p = 0; p < into.length / 4; p += 1) {
    into[p * 4] = r;
    into[p * 4 + 1] = g;
    into[p * 4 + 2] = b;
    into[p * 4 + 3] = 255;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if ((rgba[i + 3] ?? 0) === 0) continue;
      const o = (y * outWidth + x) * 4;
      into[o] = rgba[i] ?? 0;
      into[o + 1] = rgba[i + 1] ?? 0;
      into[o + 2] = rgba[i + 2] ?? 0;
    }
  }
}

/** A video's frame times in seconds, in play order, read from its packets (no decoder needed). */
export async function videoFrameTimes(file: Blob): Promise<number[]> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const times: number[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) times.push(packet.timestamp);
    return times.sort((a, b) => a - b);
  } finally {
    input.dispose();
  }
}

const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export const gifToVideoEngine: Engine<GifToVideoOptions> = {
  capabilities: () => ({
    supported: typeof VideoEncoder === 'function',
    reason: 'This browser can’t make video yet. Try a current Chrome, Edge, Safari or Firefox.',
  }),
  estimate: (input) => ({ seconds: Math.max(1, input.size / 5_000_000) }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > GIF_INPUT_LIMITS.maxBytes) {
      throw new MediaInputError('This GIF is over 200 MB, the browser limit for this tool.');
    }
    let gif;
    try {
      gif = readGif(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof GifReadError) throw new MediaInputError(error.message);
      throw error;
    }
    if (gif.width * gif.height > GIF_INPUT_LIMITS.maxPixels) {
      throw new MediaInputError('This GIF is over 4096 × 4096 px, too big to make a video from.');
    }
    const plays = Math.min(50, Math.max(1, Math.round(Number(opts.plays) || 1)));
    const totalMs = gif.durationMs * plays;
    if (totalMs > GIF_INPUT_LIMITS.maxSeconds * 1000) {
      throw new MediaInputError('The video would be over 10 minutes long. Pick fewer plays.');
    }
    const size = evenSize(gif.width, gif.height);
    const h264 = opts.format !== 'webm' && (await canEncodeVideo('avc', size));
    const vp9 = !h264 && (await canEncodeVideo('vp9', size));
    if (!h264 && !vp9) {
      throw new MediaInputError(
        'This browser can’t encode H.264 or VP9 video at this size. Try Chrome, Edge or Safari.',
      );
    }
    const target = new BufferTarget();
    const output = new Output({
      format: h264 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target,
    });
    const source = new VideoSampleSource({
      codec: h264 ? 'avc' : 'vp9',
      quality: new Quality('high'),
      // A keyframe every 2 s keeps seeking quick in long loops.
      keyFrameInterval: 2,
    });
    output.addVideoTrack(source);
    await output.start();
    const background = parseColour(opts.background);
    const frame = new Uint8Array(size.width * size.height * 4);
    const count = gif.frames.length * plays;
    let at = 0;
    let done = 0;
    let transparent = false;
    try {
      for (let play = 0; play < plays; play += 1) {
        for (const { rgba, delayMs } of gifFrames(gif)) {
          if (ctx.signal.aborted) throw new EngineAbortError();
          if (!transparent) {
            for (let i = 3; i < rgba.length; i += 4) {
              if (rgba[i] === 0) {
                transparent = true;
                break;
              }
            }
          }
          flatten(rgba, gif.width, gif.height, frame, size.width, background);
          const sample = new VideoSample(frame, {
            format: 'RGBA',
            codedWidth: size.width,
            codedHeight: size.height,
            timestamp: at / 1000,
            duration: delayMs / 1000,
          });
          await source.add(sample);
          sample.close();
          at += delayMs;
          done += 1;
          ctx.progress(done / count, 'Encoding video');
        }
      }
      source.close();
      await output.finalize();
    } catch (error) {
      await output.cancel().catch(() => undefined);
      if (ctx.signal.aborted) throw new EngineAbortError();
      throw error;
    }
    const bytes = target.buffer;
    if (!bytes) throw new Error('The encoder produced no file');
    const ext = h264 ? 'mp4' : 'webm';
    const fast = gif.frames.filter((f) => f.rawDelayMs <= 10).length;
    const notes = [
      `${String(gif.frames.length)} frames, ${secs(gif.durationMs)} a play${plays > 1 ? `, played ${String(plays)} times` : ''}; each frame keeps its own timing`,
      h264 ? 'H.264 in MP4: plays everywhere' : 'VP9 in WebM',
      ...(opts.format !== 'webm' && !h264
        ? [
            'Saved as WebM: this browser can’t encode H.264 for an MP4. Chrome, Safari and Edge can.',
          ]
        : []),
      ...(transparent ? [`Transparent areas filled with ${opts.background ?? '#ffffff'}`] : []),
      ...(size.width !== gif.width || size.height !== gif.height
        ? [
            `${String(size.width)} × ${String(size.height)} px: one row or column added, as video needs even sizes`,
          ]
        : []),
      ...(fast > 0
        ? [
            `${String(fast)} frame${fast > 1 ? 's' : ''} with no delay set play at 100 ms, as browsers show them`,
          ]
        : []),
    ];
    return {
      blob: new Blob([bytes], { type: h264 ? 'video/mp4' : 'video/webm' }),
      ext,
      durationSec: totalMs / 1000,
      path: 'Browser · WebCodecs',
      notes,
      details: [
        { label: 'Size', value: `${String(size.width)} × ${String(size.height)} px` },
        { label: 'Length', value: secs(totalMs) },
        { label: 'GIF', value: `${(file.size / 1e6).toFixed(1)} MB` },
      ],
    };
  },
};
