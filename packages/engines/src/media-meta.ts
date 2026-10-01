/**
 * The light side of the media engines (docs/10 → the engine is not in the
 * initial bundle): what a page needs before any file arrives. Whether this
 * browser can run each engine, a rough time, the limits and the GIF size
 * estimate, with no Mediabunny behind them. Pages hand these to `lazyEngine`
 * and the engines spread them in, so both answer the same.
 */
import type { Engine, InputMeta } from './types';

type Meta = Pick<Engine, 'capabilities'> & {
  estimate: (input: InputMeta) => { seconds: number };
};

const EDIT_VIDEO =
  'This browser can’t edit video yet. Try a current Chrome, Edge, Safari or Firefox.';
const READ_AUDIO =
  'This browser can’t read audio yet. Try a current Chrome, Edge, Safari or Firefox.';

const hasAudioDecoder = () => typeof AudioDecoder === 'function';

export const MEDIA_META = {
  trim: {
    capabilities: () => ({
      supported: typeof VideoDecoder === 'function' && typeof VideoEncoder === 'function',
      reason: EDIT_VIDEO,
    }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 40_000_000) }),
  },
  compress: {
    capabilities: () => ({
      supported: typeof VideoEncoder === 'function',
      reason: 'This browser can’t encode video yet. Try a current Chrome, Edge or Safari.',
    }),
    estimate: (input) => ({ seconds: Math.max(2, input.size / 8_000_000) }),
  },
  videoToGif: {
    capabilities: () => ({
      supported: typeof VideoDecoder === 'function' && typeof OffscreenCanvas !== 'undefined',
      reason:
        'This browser can’t read video frames yet. Try a current Chrome, Edge, Safari or Firefox.',
    }),
    estimate: (input) => ({ seconds: Math.max(2, input.size / 20_000_000) }),
  },
  extractAudio: {
    capabilities: () => ({ supported: hasAudioDecoder(), reason: READ_AUDIO }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 60_000_000) }),
  },
  mute: {
    capabilities: () => ({ supported: true }),
    estimate: (input) => ({ seconds: Math.max(0.5, input.size / 200_000_000) }),
  },
  videoInfo: {
    capabilities: () => ({ supported: true }),
    estimate: () => ({ seconds: 0.5 }),
  },
  gifToVideo: {
    capabilities: () => ({
      supported: typeof VideoEncoder === 'function',
      reason: 'This browser can’t make video yet. Try a current Chrome, Edge, Safari or Firefox.',
    }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 5_000_000) }),
  },
  audioConverter: {
    capabilities: () => ({ supported: hasAudioDecoder(), reason: READ_AUDIO }),
    estimate: (input) => ({ seconds: Math.max(0.5, input.size / 60_000_000) }),
  },
  trimAudio: {
    capabilities: () => ({ supported: true }),
    estimate: (input) => ({ seconds: Math.max(0.5, input.size / 60_000_000) }),
  },
  videoConverter: {
    capabilities: () => ({ supported: true }),
    estimate: (input) => ({ seconds: Math.max(0.5, input.size / 100_000_000) }),
  },
  frames: {
    capabilities: () => ({
      supported: typeof VideoDecoder === 'function' && typeof OffscreenCanvas !== 'undefined',
      reason:
        'This browser can’t read video frames yet. Try a current Chrome, Edge, Safari or Firefox.',
    }),
    estimate: () => ({ seconds: 2 }),
  },
  rotate: {
    capabilities: () => ({ supported: true }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 20_000_000) }),
  },
  reframe: {
    capabilities: () => ({
      supported: typeof VideoEncoder === 'function' && typeof OffscreenCanvas !== 'undefined',
      reason: EDIT_VIDEO,
    }),
    estimate: (input) => ({ seconds: Math.max(2, input.size / 8_000_000) }),
  },
  replaceAudio: {
    capabilities: () => ({
      supported: typeof AudioEncoder === 'function' && hasAudioDecoder(),
      reason: EDIT_VIDEO,
    }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 30_000_000) }),
  },
  audioEdit: {
    capabilities: () => ({ supported: hasAudioDecoder(), reason: READ_AUDIO }),
    estimate: (input) => ({ seconds: Math.max(0.5, input.size / 40_000_000) }),
  },
  loudness: {
    capabilities: () => ({ supported: hasAudioDecoder(), reason: READ_AUDIO }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 15_000_000) }),
  },
  bpmKey: {
    capabilities: () => ({ supported: hasAudioDecoder(), reason: READ_AUDIO }),
    estimate: (input) => ({ seconds: Math.max(1, input.size / 20_000_000) }),
  },
} satisfies Record<string, Meta>;

/** Audio tools (tools/audio.md → Limits). */
export const AUDIO_LIMITS = { maxBytes: 1024 ** 3, maxSeconds: 4 * 60 * 60 };

/** GIF to MP4 (tools/video.md → V05 limits). */
export const GIF_INPUT_LIMITS = {
  maxBytes: 200 * 1024 ** 2,
  maxPixels: 4096 * 4096,
  maxSeconds: 10 * 60,
};

/** How many frames a range makes at a rate and speed. */
export function gifFrameCount(seconds: number, fps: number, speed: number): number {
  return Math.max(1, Math.floor((seconds / speed) * fps + 1e-6));
}

/** A rough size before starting: bytes per pixel per frame seen on dithered video GIFs. */
export function estimateGifBytes(frames: number, width: number, height: number): number {
  return Math.round(frames * width * height * 0.45);
}
