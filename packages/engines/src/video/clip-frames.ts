/**
 * A clip's frames, read forwards or backwards (V18 Reverse Video, V19 Loop
 * Video's boomerang). Every frame's time comes from its packet, so each frame
 * keeps its own duration. Frames are copied out of the decoder as soon as
 * they arrive, so the decoder never runs short of frames, and drawn at the
 * clip's display size, rotation applied, rounded to even (encoderSize).
 *
 * Backwards, the clip is read in stretches from its end: each stretch is
 * decoded (from the keyframe before it) and handed out last frame first. A
 * stretch holds as many frames as fit in a fixed memory budget, so memory
 * doesn't grow with the clip's length.
 */
import { EncodedPacketSink, VideoSample, VideoSampleSink, type InputVideoTrack } from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { even, shownFor } from './held';
import { MediaInputError } from './media';

// A side rounded to even (`even`, shared with Merge Videos and Video Speed):
// H.264 and HEVC encoders refuse odd sizes (1437 × 899 is drawn at 1438 × 900).
export { even };

/** The size a clip is encoded at again: its display size, rotation applied, each side even. */
export async function encoderSize(
  video: InputVideoTrack,
): Promise<{ width: number; height: number }> {
  return {
    width: even(await video.getDisplayWidth()),
    height: even(await video.getDisplayHeight()),
  };
}

/**
 * An output track's frame rate: the clip's own when its frames sit on a
 * steady clock, else none. Mediabunny snaps every timestamp of a track that
 * has a frame rate to it, so a variable frame rate given one comes out
 * constant (and two close frames can land on one time).
 */
export function steadyRate(metrics: { underlyingFrameRate: number | null } | null): {
  frameRate?: number;
} {
  const rate = metrics?.underlyingFrameRate;
  return rate && rate > 0 ? { frameRate: rate } : {};
}

/** Bytes of frames held at once while a stretch is turned round. */
const BUDGET = 384 * 1024 ** 2;

/** Frames held per stretch for a picture this size (RGBA copies): 8 to 90 (3 s at 30 fps). */
export function framesPerStretch(width: number, height: number): number {
  return Math.max(8, Math.min(90, Math.floor(BUDGET / Math.max(1, width * height * 4))));
}

/** Two timestamps closer than this are the same frame, seconds. */
const EPSILON = 1e-6;

export interface ClipFrame {
  /** A copy the caller owns: retime it, encode it, close it. */
  copy: VideoSample;
  /** The frame's place in the clip, in the order shown. */
  index: number;
}

export class ClipFrames {
  private readonly sink: VideoSampleSink;
  private readonly ctx2d: OffscreenCanvasRenderingContext2D;

  private constructor(
    video: InputVideoTrack,
    /** Every frame's time, in the order shown. */
    readonly times: number[],
    /** Where the last frame stops showing, seconds. */
    readonly end: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.sink = new VideoSampleSink(video);
    const ctx2d = new OffscreenCanvas(width, height).getContext('2d');
    if (!ctx2d) throw new Error('No 2D canvas in this browser');
    this.ctx2d = ctx2d;
  }

  static async read(video: InputVideoTrack, fps: number, signal: AbortSignal): Promise<ClipFrames> {
    const times: number[] = [];
    for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
      metadataOnly: true,
    })) {
      if (signal.aborted) throw new EngineAbortError();
      times.push(packet.timestamp);
    }
    times.sort((a, b) => a - b);
    if (times.length === 0) throw new MediaInputError('This video has no frames in it.');
    const size = await encoderSize(video);
    return new ClipFrames(video, times, await shownFor(video, fps), size.width, size.height);
  }

  get count(): number {
    return this.times.length;
  }

  /** How long frame `index` shows: until the next one, or the clip's end. */
  duration(index: number): number {
    const at = this.times[index] ?? 0;
    return Math.max(1e-3, (this.times[index + 1] ?? this.end) - at);
  }

  private copyOf(frame: VideoSample): VideoSample {
    this.ctx2d.clearRect(0, 0, this.width, this.height);
    frame.drawWithFit(this.ctx2d, { fit: 'fill' });
    return new VideoSample(this.ctx2d.canvas, { timestamp: frame.timestamp });
  }

  /** Frames `lo` to `hi − 1` as decoded, copied. */
  private async *decode(lo: number, hi: number, signal: AbortSignal): AsyncGenerator<ClipFrame> {
    const from = this.times[lo] ?? 0;
    const to = this.times[hi];
    let index = lo;
    for await (const frame of this.sink.samples(from, to)) {
      if (signal.aborted) {
        frame.close();
        throw new EngineAbortError();
      }
      // The frame showing at `from` may start before it: that one belongs to the stretch before.
      if (
        frame.timestamp < from - EPSILON ||
        (to !== undefined && frame.timestamp >= to - EPSILON)
      ) {
        frame.close();
        continue;
      }
      const copy = this.copyOf(frame);
      frame.close();
      yield { copy, index };
      index += 1;
    }
  }

  /** Frames `lo` to `hi − 1`, first to last. */
  async *forward(lo: number, hi: number, signal: AbortSignal): AsyncGenerator<ClipFrame> {
    yield* this.decode(lo, hi, signal);
  }

  /** Frames `hi − 1` down to `lo`, a stretch at a time. */
  async *backward(lo: number, hi: number, signal: AbortSignal): AsyncGenerator<ClipFrame> {
    const per = framesPerStretch(this.width, this.height);
    for (let top = hi; top > lo; top -= per) {
      const bottom = Math.max(lo, top - per);
      const held: ClipFrame[] = [];
      try {
        for await (const frame of this.decode(bottom, top, signal)) held.push(frame);
        for (let frame = held.pop(); frame; frame = held.pop()) yield frame;
      } finally {
        // Whatever wasn't handed out, after an error or a cancel.
        for (const frame of held) frame.copy.close();
      }
    }
  }
}
