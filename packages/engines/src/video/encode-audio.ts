/**
 * Re-encodes one audio track on its own (extract, convert, trim audio). It
 * decodes, keeps the blocks on one unbroken timeline from 0 and encodes, so
 * the file is exactly as long as the part of the track asked for: blocks
 * that overlap lose the overlap, and a gap (a damaged frame the decoder
 * skipped, a track that starts late or stops early) becomes silence rather
 * than pulling the rest of the audio earlier.
 */
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  Output,
  type AudioCodec,
  type Input,
  type InputAudioTrack,
  type OutputFormat,
  type Quality,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { MediaInputError, type RunOutput } from './media';

const BYTES: Record<string, number> = { u8: 1, s16: 2, s32: 4, f32: 4 };

interface Shape {
  format: AudioSample['format'];
  sampleRate: number;
  numberOfChannels: number;
}

/** Silence in the given shape, `frames` long from `timestamp`. */
function silence(shape: Shape, timestamp: number, frames: number): AudioSample {
  const base = shape.format.replace('-planar', '');
  const data = new Uint8Array((BYTES[base] ?? 4) * frames * shape.numberOfChannels);
  if (base === 'u8') data.fill(128);
  return new AudioSample({ ...shape, data, timestamp });
}

/** `sample` without its first `skip` frames. */
function dropStart(sample: AudioSample, skip: number): AudioSample {
  const frames = sample.numberOfFrames - skip;
  const channels = sample.numberOfChannels;
  const data = new Float32Array(frames * channels);
  for (let c = 0; c < channels; c += 1) {
    sample.copyTo(data.subarray(c * frames, (c + 1) * frames), {
      planeIndex: c,
      format: 'f32-planar',
      frameOffset: skip,
      frameCount: frames,
    });
  }
  const out = new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: channels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp + skip / sample.sampleRate,
  });
  sample.close();
  return out;
}

/**
 * Keeps decoded blocks on one unbroken timeline from 0: a block that starts
 * before the last one ended loses the overlap, and a gap before one, or
 * before the end, is filled with silence. A frame or two either way is
 * timestamp rounding and left alone.
 */
export function seamless() {
  let next = 0;
  let shape: Shape | null = null;
  return {
    /** The blocks to encode for one decoded block, in order. */
    add(sample: AudioSample): AudioSample[] {
      const rate = sample.sampleRate;
      shape ??= {
        format: sample.format,
        sampleRate: rate,
        numberOfChannels: sample.numberOfChannels,
      };
      const out: AudioSample[] = [];
      const gap = Math.round((sample.timestamp - next) * rate);
      let block = sample;
      if (gap > 2) {
        out.push(silence(shape, next, gap));
      } else if (gap < -2) {
        if (-gap >= sample.numberOfFrames) {
          sample.close();
          return out;
        }
        block = dropStart(sample, -gap);
      }
      next = Math.max(next, block.timestamp + block.numberOfFrames / rate);
      out.push(block);
      return out;
    },
    /** Silence from the last block to `end`, when the decoder stopped short of it. */
    finish(end: number): AudioSample | null {
      if (!shape) return null;
      const frames = Math.round((end - next) * shape.sampleRate);
      if (frames <= 2) return null;
      const tail = silence(shape, next, frames);
      next = end;
      return tail;
    },
    /** Where the timeline has got to, seconds. */
    get time() {
      return next;
    },
    get started() {
      return shape !== null;
    },
  };
}

export interface EncodeAudioOptions {
  input: Input;
  track: InputAudioTrack;
  format: OutputFormat;
  codec: AudioCodec;
  quality?: Quality;
  sampleRate?: number;
  numberOfChannels?: number;
  /** Seconds of the track; the output starts at 0. Defaults to all of it. */
  start?: number;
  end?: number;
  /** Runs on each block once it is on the output timeline (and resampled, remixed). */
  process?: (sample: AudioSample) => AudioSample | AudioSample[] | null;
}

/** Decodes the range of the track and encodes it into `format`, with its tags. */
export async function encodeAudio(
  options: EncodeAudioOptions,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<RunOutput> {
  const { input, track, format } = options;
  const trackEnd = await track.computeDuration();
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(options.end ?? trackEnd, trackEnd);
  const length = end - start;
  const target = new BufferTarget();
  const output = new Output({ format, target });
  output.setMetadataTags(await input.getMetadataTags());
  const source = new AudioSampleSource({
    codec: options.codec,
    ...(options.quality && { quality: options.quality }),
    transform: {
      ...(options.sampleRate && { sampleRate: options.sampleRate }),
      ...(options.numberOfChannels && { numberOfChannels: options.numberOfChannels }),
      ...(options.process && { process: options.process }),
    },
  });
  output.addAudioTrack(source);
  await output.start();
  const line = seamless();
  const encode = async (blocks: AudioSample[]) => {
    for (const block of blocks) {
      await source.add(block);
      block.close();
    }
  };
  try {
    for await (const decoded of new AudioSampleSink(track).samples(start, end)) {
      if (signal.aborted) {
        decoded.close();
        throw new EngineAbortError();
      }
      // Only the frames inside the range, moved so the range starts at 0.
      const rate = decoded.sampleRate;
      const from = Math.max(0, Math.round((start - decoded.timestamp) * rate));
      const to = Math.min(decoded.numberOfFrames, Math.round((end - decoded.timestamp) * rate));
      if (to <= from) {
        decoded.close();
        continue;
      }
      let piece = decoded;
      if (from > 0 || to < decoded.numberOfFrames) {
        piece = decoded.trim(from, to);
        decoded.close();
      }
      piece.setTimestamp(piece.timestamp - start);
      await encode(line.add(piece));
      progress(Math.min(1, line.time / length));
    }
    if (!line.started) {
      throw new MediaInputError('No audio could be decoded from this file.');
    }
    const tail = line.finish(length);
    if (tail) await encode([tail]);
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    if (signal.aborted) throw new EngineAbortError();
    throw error;
  }
  if (signal.aborted) throw new EngineAbortError();
  const bytes = target.buffer;
  if (!bytes) throw new Error('The encoder produced no file');
  return { bytes, mime: format.mimeType, ext: format.fileExtension.slice(1) };
}
