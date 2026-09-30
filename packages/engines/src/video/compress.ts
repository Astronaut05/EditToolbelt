/**
 * V02 Compress Video. Target-size mode works out the video bitrate from the
 * size (tools/video.md → V02): (target × 0.97 × 8 ÷ duration) − audio. When
 * that leaves too few bits per pixel for the picture, Auto resolution steps
 * the size down until it looks right again. WebCodecs has no two-pass
 * encoding, so if a pass overshoots, a second pass scales the bitrate down.
 */
import {
  canEncodeVideo,
  EncodedPacketSink,
  Quality,
  type Input,
  type VideoCodec,
} from 'mediabunny';

import type { Engine, EngineOutput } from '../types';
import { codecLabel, convert, MediaInputError, openInput, pickOutput } from './media';
import { containerFormat } from './trim';

export interface CompressOptions {
  /** target (a size) or quality */
  mode?: string;
  /** MB: "8", "10", "16", "25", "50", "100", or "custom" (then targetMb). */
  target?: string;
  targetMb?: string;
  /** high, medium or small */
  quality?: string;
  /** auto, keep, or the short side: "1080", "720", "480", "360" */
  resolution?: string;
  /** keep, or "30", "24", "15" */
  fps?: string;
  /** avc, hevc, av1 or vp9 */
  codec?: string;
  /** keep or remove */
  audio?: string;
}

export interface CompressSource {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  /** Bits per second the kept audio takes. */
  audioBps: number;
}

export interface CompressPlan {
  width: number;
  height: number;
  /** Set when lowering the frame rate. */
  fps?: number;
  /** Target mode: bytes and video bits per second. */
  targetBytes?: number;
  videoBps?: number;
  /** Quality mode. */
  level?: 'high' | 'medium' | 'low';
  notes: string[];
}

/** MB as file managers and chat apps count them: 1,000,000 bytes, so "under 25 MB" holds either way. */
const MB = 1_000_000;
const SHORT_SIDES = [2160, 1440, 1080, 720, 540, 480, 360, 240];

/** Bits per pixel per frame below which video turns blocky (H.265 and AV1 manage with less). */
export const minBpp = (codec: string) => (codec === 'hevc' || codec === 'av1' ? 0.035 : 0.05);

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** A frame size with the given short side, keeping the shape. */
export function sizeForShortSide(width: number, height: number, short: number) {
  const portrait = height > width;
  const scale = short / Math.min(width, height);
  return portrait
    ? { width: even(short), height: even(height * scale) }
    : { width: even(width * scale), height: even(short) };
}

export function planCompress(
  source: CompressSource,
  opts: CompressOptions,
  codec: string,
): CompressPlan {
  const notes: string[] = [];
  const fpsWanted = Number(opts.fps);
  const fps =
    Number.isFinite(fpsWanted) && fpsWanted > 0 && fpsWanted < source.fps - 0.5
      ? fpsWanted
      : undefined;
  const frameRate = fps ?? source.fps;
  const short = Math.min(source.width, source.height);
  const fixed = Number(opts.resolution);
  let size =
    Number.isFinite(fixed) && fixed > 0 && fixed < short
      ? sizeForShortSide(source.width, source.height, fixed)
      : { width: even(source.width), height: even(source.height) };

  if (opts.mode !== 'target') {
    const level = opts.quality === 'high' ? 'high' : opts.quality === 'small' ? 'low' : 'medium';
    return { ...size, fps, level, notes };
  }

  const mb = opts.target === 'custom' ? Number(opts.targetMb) : Number(opts.target);
  if (!Number.isFinite(mb) || mb <= 0) throw new MediaInputError('Enter the target size in MB.');
  const targetBytes = mb * MB;
  const videoBps = (targetBytes * 0.97 * 8) / source.durationSec - source.audioBps;
  if (videoBps < 50_000) {
    const audioMb = (source.audioBps * source.durationSec) / 8 / MB;
    throw new MediaInputError(
      source.audioBps > 0 && audioMb > mb * 0.5
        ? `${String(mb)} MB is too small for this video: the sound alone takes ${audioMb.toFixed(1)} MB. Remove the audio or pick a bigger size.`
        : `${String(mb)} MB is too small for ${Math.round(source.durationSec).toString()} s of video. Pick a bigger size, or trim the video first.`,
    );
  }
  const bpp = (s: { width: number; height: number }) => videoBps / (s.width * s.height * frameRate);
  if (opts.resolution === 'auto' || opts.resolution === undefined) {
    for (const side of SHORT_SIDES) {
      if (bpp(size) >= minBpp(codec)) break;
      if (side < Math.min(size.width, size.height)) {
        size = sizeForShortSide(source.width, source.height, side);
      }
    }
    if (size.width !== even(source.width)) {
      notes.push(
        `Scaled down to ${String(size.width)} × ${String(size.height)} px, so ${String(mb)} MB still looks clean`,
      );
    }
  }
  if (bpp(size) < minBpp(codec) * 0.6) {
    notes.push(
      'Very few bits for this length: expect a blocky picture. A bigger size or a shorter clip helps.',
    );
  }
  return { ...size, fps, targetBytes, videoBps, notes };
}

/** What the audio will cost: its packets' bytes over its length. */
async function audioBitrate(input: Input): Promise<number> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) return 0;
  let bytes = 0;
  let last = 0;
  for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, {
    metadataOnly: true,
  })) {
    bytes += packet.byteLength;
    last = packet.timestamp + packet.duration;
  }
  return last > 0 ? (bytes * 8) / last : 0;
}

const CODECS: readonly string[] = ['avc', 'hevc', 'av1', 'vp9'];

export const compressEngine: Engine<CompressOptions> = {
  capabilities: () => ({
    supported: typeof VideoEncoder === 'function',
    reason: 'This browser can’t encode video yet. Try a current Chrome, Edge or Safari.',
  }),
  estimate: (input) => ({ seconds: Math.max(2, input.size / 8_000_000) }),
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video to compress.');
      if (!(await video.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode ${codecLabel(await video.getCodec())} video, so it can’t compress it. Try Chrome, Edge or Safari.`,
        );
      }
      const durationSec = await input.computeDuration();
      const metrics = await video.computeFrameRateMetrics().catch(() => null);
      const keepAudio = opts.audio !== 'remove';
      const audioTrack = keepAudio ? await input.getPrimaryAudioTrack() : null;
      const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
      const width = await video.getDisplayWidth();
      const height = await video.getDisplayHeight();

      // The container and codec this browser can write.
      let wanted = opts.codec && CODECS.includes(opts.codec) ? opts.codec : 'avc';
      const notes: string[] = [];
      if (
        (wanted === 'hevc' || wanted === 'av1') &&
        !(await canEncodeVideo(wanted, { width, height }))
      ) {
        notes.push(`This browser can’t encode ${codecLabel(wanted)}, so it used H.264`);
        wanted = 'avc';
      }
      let codec: VideoCodec = wanted as VideoCodec;
      let container: 'mp4' | 'webm' = wanted === 'vp9' ? 'webm' : 'mp4';
      let audioOut: 'aac' | 'opus' = container === 'mp4' ? 'aac' : 'opus';
      if (wanted === 'avc' || wanted === 'vp9') {
        const plan = await pickOutput(
          container,
          { width, height },
          { needsEncode: Boolean(audioTrack), copyable: audioCodec === 'aac' },
        );
        container = plan.container;
        codec = plan.video;
        audioOut = plan.audio;
        if (plan.note) notes.push(plan.note);
      }
      // Copied AAC keeps its bitrate; re-encoded audio is 128 kbps AAC or 96 kbps Opus.
      const audioCopied = audioCodec !== null && audioCodec === audioOut;
      const audioBps = !audioTrack
        ? 0
        : audioCopied
          ? await audioBitrate(input)
          : audioOut === 'aac'
            ? 128_000
            : 96_000;

      const source: CompressSource = {
        durationSec,
        width,
        height,
        fps: metrics?.bestGuessFrameRate ?? 30,
        audioBps,
      };
      const plan = planCompress(source, opts, codec);
      notes.push(...plan.notes);

      const pass = async (videoBps: number | undefined, label: string) =>
        convert(
          {
            input,
            format: containerFormat(container),
            video: {
              codec,
              width: plan.width,
              height: plan.height,
              fit: 'fill',
              ...(plan.fps && { frameRate: plan.fps }),
              // A size target asks for constant bitrate: encoders keep to it far better.
              quality: videoBps
                ? new Quality({ bitrate: Math.round(videoBps), bitrateMode: 'constant' })
                : new Quality(plan.level ?? 'medium'),
              forceTranscode: true,
            },
            audio: keepAudio
              ? {
                  codec: audioOut,
                  ...(!audioCopied && { quality: new Quality({ bitrate: audioBps }) }),
                }
              : { discard: true },
          },
          ctx.signal,
          (f) => {
            ctx.progress(f, label);
          },
        );

      let out = await pass(plan.videoBps, 'Compressing');
      if (plan.targetBytes && plan.videoBps) {
        // Encoders drift at low bitrates: correct the video's share (the audio's is fixed).
        const audioBytes = (audioBps * durationSec) / 8;
        const videoBudget = plan.targetBytes * 0.97 - audioBytes;
        let videoBps = plan.videoBps;
        for (let extra = 1; extra <= 2 && out.bytes.byteLength > plan.targetBytes; extra += 1) {
          const videoBytes = Math.max(1, out.bytes.byteLength - audioBytes);
          videoBps *= Math.max(0.3, (videoBudget * 0.97) / videoBytes);
          const before = out.bytes.byteLength;
          out = await pass(videoBps, 'Another pass to fit the size');
          // The encoder has a floor at this size; more passes won't get under it.
          if (out.bytes.byteLength > before * 0.98) break;
        }
        const over = videoBps !== plan.videoBps;
        // Some encoders (Safari's among them) land far under the bitrate asked for:
        // one pass up spends the room the target leaves, if it still fits.
        if (!over && out.bytes.byteLength < plan.targetBytes * 0.7) {
          const videoBytes = Math.max(1, out.bytes.byteLength - audioBytes);
          const up = Math.min(2, (videoBudget * 0.97) / videoBytes);
          if (up > 1.15) {
            const larger = await pass(videoBps * up, 'Another pass to use the size');
            if (larger.bytes.byteLength <= plan.targetBytes) {
              out = larger;
              notes.push('Took a second pass: the first came out well under the target');
            }
          }
        }
        if (over) notes.push('Took more than one pass to land under the target');
      }
      if (plan.targetBytes && out.bytes.byteLength > plan.targetBytes) {
        notes.push('Still a little over the target. Pick a smaller size or a lower resolution.');
      }

      const before = file.size;
      if (!plan.targetBytes && out.bytes.byteLength >= before) {
        return {
          blob: file,
          ext: out.ext,
          durationSec,
          path: 'Browser · WebCodecs',
          notes: ['Already smaller than this setting makes it: this is your original file'],
        };
      }
      notes.push(
        `${codecLabel(codec)} at ${String(plan.width)} × ${String(plan.height)} px${plan.fps ? `, ${String(plan.fps)} fps` : ''}`,
        !keepAudio
          ? 'Audio removed'
          : audioCopied
            ? `${codecLabel(audioCodec)} audio copied without re-encoding`
            : `Audio re-encoded as ${codecLabel(audioOut)}`,
        ...out.dropped,
      );
      const change = Math.round((1 - out.bytes.byteLength / before) * 100);
      return {
        blob: new Blob([out.bytes], { type: out.mime }),
        ext: out.ext,
        width: plan.width,
        height: plan.height,
        durationSec,
        path: 'Browser · WebCodecs',
        notes,
        details: [
          {
            label: 'Video',
            value: `${codecLabel(codec)} · ${String(plan.width)} × ${String(plan.height)}`,
          },
          { label: 'Change', value: change > 0 ? `−${String(change)}%` : `+${String(-change)}%` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
