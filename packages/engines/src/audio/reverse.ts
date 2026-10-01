/**
 * A15 Reverse Audio (tools/audio.md): the whole file, or the timeline's
 * selection with the rest left as it is. The track is read backwards ten
 * seconds at a time (@etb/core's reversePieces), each window decoded from a
 * little before it so a lossy codec has settled, then turned round and
 * encoded in the file's own format unless another is picked. Memory stays at
 * one window, however long the file.
 */
import { joinGain, reversePieces, type ReversePiece } from '@etb/core';
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  Output,
  Quality,
  type InputAudioTrack,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { AUDIO_LIMITS, MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import {
  AUDIO_TARGETS,
  ensureEncoder,
  KEEP_FORMAT,
  type AudioFormat,
} from '../video/extract-audio';
import { codecLabel, MediaInputError, openInput } from '../video/media';
import { planesOf } from './stream';

export interface ReverseAudioOptions {
  /** The timeline's selection, seconds. The whole file when it spans it all. */
  start?: number;
  end?: number;
  format?: string;
}

/** Seconds read and turned round at a time. */
const WINDOW = 10;
/** Seconds decoded before each window and thrown away: a lossy decoder's warm-up. */
const PREROLL = 0.2;
/** The dip at a join between reversed and untouched audio, seconds each side. */
const JOIN_FADE = 0.005;
/** Frames per sample handed to the encoder. */
const BLOCK = 4096;
/** A selection this close to the start or end counts as reaching it, seconds. */
const EDGE = 0.01;

interface Block {
  /** The frame index of the block's first frame. */
  at: number;
  planes: Float32Array[];
}

/**
 * Frames `piece.from`–`piece.to` of the track, `channels` wide, in blocks as
 * they decode. Every piece maps a sample's timestamp to frames the same way,
 * so the pieces meet with no frame lost or doubled.
 */
async function* read(
  sink: AudioSampleSink,
  piece: ReversePiece,
  rate: number,
  channels: number,
  signal: AbortSignal,
): AsyncGenerator<Block> {
  const until = piece.to === null ? undefined : piece.to / rate;
  for await (const decoded of sink.samples(Math.max(0, piece.from / rate - PREROLL), until)) {
    if (signal.aborted) {
      decoded.close();
      throw new EngineAbortError();
    }
    const first = Math.round(decoded.timestamp * rate);
    const from = Math.max(0, piece.from - first);
    const to = Math.min(decoded.numberOfFrames, (piece.to ?? Infinity) - first);
    if (to > from) yield { at: first + from, planes: planesOf(decoded, channels, from, to) };
    decoded.close();
  }
}

/**
 * A window's blocks as one stretch, turned round. A window with an end is
 * exactly that long: frames the track doesn't have there are silence.
 */
function backwards(blocks: Block[], piece: ReversePiece, channels: number): Float32Array[] {
  const end = blocks.reduce(
    (most, block) => Math.max(most, block.at + (block.planes[0]?.length ?? 0)),
    piece.from,
  );
  const length = (piece.to ?? end) - piece.from;
  return Array.from({ length: channels }, (_, c) => {
    const plane = new Float32Array(length);
    for (const block of blocks) {
      const part = block.planes[c] ?? new Float32Array(0);
      const at = block.at - piece.from;
      plane.set(part.subarray(0, Math.max(0, length - at)), at);
    }
    return plane.reverse();
  });
}

const silence = (frames: number, channels: number) =>
  Array.from({ length: channels }, () => new Float32Array(frames));

/**
 * The track's frames in `pieces`' order: forward pieces block by block,
 * reversed ones a window at a time, turned round. Every piece with an end is
 * exactly that long, with silence where the track has no sound, so pieces
 * laid end to end stay in step with a picture (V18, V19).
 */
export async function* reversedFrames(
  track: InputAudioTrack,
  pieces: ReversePiece[],
  channels: number,
  signal: AbortSignal,
): AsyncGenerator<Float32Array[]> {
  const rate = await track.getSampleRate();
  const sink = new AudioSampleSink(track);
  for (const piece of pieces) {
    if (piece.reverse) {
      const blocks: Block[] = [];
      for await (const block of read(sink, piece, rate, channels, signal)) blocks.push(block);
      yield backwards(blocks, piece, channels);
    } else {
      let next = piece.from;
      for await (const block of read(sink, piece, rate, channels, signal)) {
        if (block.at > next) yield silence(block.at - next, channels);
        yield block.planes;
        next = block.at + (block.planes[0]?.length ?? 0);
      }
      if (piece.to !== null && next < piece.to) yield silence(piece.to - next, channels);
    }
  }
}

async function openTrack(file: Blob) {
  if (file.size > AUDIO_LIMITS.maxBytes) {
    throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
  }
  const input = openInput(file);
  const track: InputAudioTrack | null = await input.getPrimaryAudioTrack();
  if (!track) {
    input.dispose();
    throw new MediaInputError('This file has no audio in it.');
  }
  const codec = await track.getCodec();
  if (!(await track.canDecode())) {
    input.dispose();
    throw new MediaInputError(
      `This browser can’t decode the ${codecLabel(codec)} audio in this file.`,
    );
  }
  return { input, track, codec };
}

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m)}:${s.toFixed(3).padStart(6, '0')}`;
};

export const reverseAudioEngine: Engine<ReverseAudioOptions> = {
  ...MEDIA_META.audioEdit,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const { input, track, codec } = await openTrack(file);
    try {
      const keep = codec ? KEEP_FORMAT[codec] : undefined;
      const format: AudioFormat =
        opts.format && opts.format in AUDIO_TARGETS
          ? (opts.format as AudioFormat)
          : (keep ?? 'wav');
      const target = AUDIO_TARGETS[format];
      const outCodec = format === 'wav' && codec?.startsWith('pcm') ? codec : target.codec;
      await ensureEncoder(outCodec);
      const rate = await track.getSampleRate();
      const own = await track.getNumberOfChannels();
      // Lossy encoders here take mono or stereo: past that, the front two.
      const channels = target.lossy ? Math.min(2, own) : own;
      const duration = await track.computeDuration();
      if (duration > AUDIO_LIMITS.maxSeconds) {
        throw new MediaInputError('This file is over 4 hours long, the browser limit for audio.');
      }

      const start = Math.max(0, Math.min(duration, opts.start ?? 0));
      const end = Math.max(start, Math.min(duration, opts.end ?? duration));
      if (end - start < 0.01) throw new MediaInputError('Select at least 10 ms to reverse.');
      const fromStart = start <= EDGE;
      const toEnd = end >= duration - EDGE;
      const whole = fromStart && toEnd;
      const total = Math.round(duration * rate);
      const pieces = reversePieces(
        fromStart ? 0 : start * rate,
        toEnd ? null : end * rate,
        WINDOW * rate,
        total,
      );
      // The joins between reversed and untouched audio, as output frames: the lengths don't change.
      const joins = [
        ...(fromStart ? [] : [Math.round(start * rate)]),
        ...(toEnd ? [] : [Math.round(end * rate)]),
      ];
      const fade = Math.round(JOIN_FADE * rate);

      const buffer = new BufferTarget();
      const output = new Output({ format: target.format(), target: buffer });
      output.setMetadataTags(await input.getMetadataTags());
      const bitrate = target.lossy
        ? ((await track.getAverageBitrate().catch(() => null)) ?? 192_000)
        : null;
      const source = new AudioSampleSource({
        codec: outCodec,
        ...(bitrate && { quality: new Quality({ bitrate }) }),
      });
      output.addAudioTrack(source);
      await output.start();

      let written = 0;
      const write = async (planes: Float32Array[]) => {
        const n = planes[0]?.length ?? 0;
        for (let at = 0; at < n; at += BLOCK) {
          const count = Math.min(BLOCK, n - at);
          const data = new Float32Array(count * channels);
          planes.forEach((plane, c) => {
            const part = plane.subarray(at, at + count);
            if (joins.length > 0) {
              for (let i = 0; i < count; i += 1) {
                const gain = joinGain(written + i, joins, fade);
                data[c * count + i] = (part[i] ?? 0) * gain;
              }
            } else {
              data.set(part, c * count);
            }
          });
          const sample = new AudioSample({
            data,
            format: 'f32-planar',
            numberOfChannels: channels,
            sampleRate: rate,
            timestamp: written / rate,
          });
          await source.add(sample);
          sample.close();
          written += count;
          ctx.progress(Math.min(1, written / Math.max(1, total)), 'Reversing');
        }
      };

      try {
        for await (const planes of reversedFrames(track, pieces, channels, ctx.signal)) {
          await write(planes);
        }
        source.close();
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        if (ctx.signal.aborted) throw new EngineAbortError();
        throw error;
      }
      const bytes = buffer.buffer;
      if (!bytes) throw new Error('No file was written');
      const length = written / rate;
      const part = whole ? 'Whole file' : `${clock(start)}–${clock(end)}`;
      return {
        blob: new Blob([bytes], { type: target.mime }),
        ext: target.ext,
        durationSec: length,
        path: 'Browser · WebCodecs',
        notes: [
          whole
            ? `Reversed the whole file: ${length.toFixed(2)} s`
            : `Reversed ${part}, the rest as it was`,
          target.lossy
            ? `Re-encoded as ${codecLabel(outCodec)} at the file's own bitrate`
            : `${outCodec === 'flac' ? 'FLAC' : 'PCM'}: lossless`,
          ...(channels < own ? [`The front 2 of ${String(own)} channels kept`] : []),
        ],
        details: [
          { label: 'Reversed', value: part },
          { label: 'Length', value: `${length.toFixed(2)} s` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
