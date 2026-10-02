/**
 * A10 Noise Reduction, the browser's part (tools/audio.md → A10). Our servers
 * do the cleaning; the page:
 * - reads the file: its sound, whether it has a picture, whether our servers
 *   read it as it is, and where the free preview should start (the stretch
 *   whose background is loudest, in the first few minutes);
 * - cuts the 10 s preview snippet as WAV;
 * - for a video, or audio our servers don't take (AIFF, WebM, CAF …), decodes
 *   the sound and sends it as FLAC, so the picture never leaves the device;
 * - puts the cleaned sound back into the video: the picture is copied, and
 *   every block of sound is replaced, sample for sample, where it was, so the
 *   length and the sync don't move.
 */
import {
  flacBytes,
  LEVEL_WINDOW_SEC,
  NOISE_PREVIEW_SECONDS,
  previewStart as pickStart,
} from '@etb/core';
import {
  AdtsInputFormat,
  AudioSample,
  AudioSampleSink,
  FlacInputFormat,
  FlacOutputFormat,
  getFirstEncodableAudioCodec,
  Mp3InputFormat,
  Mp4InputFormat,
  OggInputFormat,
  Quality,
  WaveInputFormat,
  WavOutputFormat,
  type AudioCodec,
  type Input,
  type InputAudioTrack,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import type { EngineOutput } from '../types';
import { encodeAudio } from '../video/encode-audio';
import { ensureEncoder } from '../video/extract-audio';
import { codecLabel, convert, MediaInputError, openInput } from '../video/media';
import { containerFormat, sourceFamily } from '../video/trim';

/** How much of a file is read to place the preview: enough to find a noisy stretch, quickly. */
const SCAN_SECONDS = 180;

/** A file our servers read as it is: the name and type it goes up with. */
export interface ServerType {
  ext: string;
  mime: string;
}

export interface NoiseProbe {
  durationSec: number;
  /** It has a picture: only the sound goes up, and comes back into the video. */
  video: boolean;
  /** Our servers take the file as it is; otherwise its sound goes up as FLAC. */
  serverType: ServerType | null;
  sampleRate: number;
  channels: number;
  codec: string | null;
  canDecode: boolean;
  /** Where the preview starts, seconds. */
  previewFrom: number;
  /** About what a full run uploads. */
  sendBytes: number;
  /** "MP3 · 44.1 kHz · stereo · 3:12" */
  summary: string;
}

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'stereo' };

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m >= 60
    ? `${String(Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m)}:${String(s).padStart(2, '0')}`;
}

/** The container, when our servers read it as it is (audio only). */
async function serverType(input: Input, video: boolean): Promise<ServerType | null> {
  if (video) return null;
  const format = await input.getFormat();
  if (format instanceof Mp3InputFormat) return { ext: 'mp3', mime: 'audio/mpeg' };
  if (format instanceof WaveInputFormat) return { ext: 'wav', mime: 'audio/wav' };
  if (format instanceof FlacInputFormat) return { ext: 'flac', mime: 'audio/flac' };
  if (format instanceof OggInputFormat) return { ext: 'ogg', mime: 'audio/ogg' };
  if (format instanceof AdtsInputFormat) return { ext: 'aac', mime: 'audio/aac' };
  if (format instanceof Mp4InputFormat) return { ext: 'm4a', mime: 'audio/mp4' };
  return null;
}

/** dBFS RMS of the sound (all channels) in 50 ms windows, from the start, for `seconds`. */
async function levels(track: InputAudioTrack, seconds: number): Promise<number[]> {
  const out: number[] = [];
  let sum = 0;
  let count = 0;
  let window = 0;
  for await (const sample of new AudioSampleSink(track).samples(0, seconds)) {
    try {
      const frames = sample.numberOfFrames;
      window ||= Math.max(1, Math.round(sample.sampleRate * LEVEL_WINDOW_SEC));
      const planes = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
        const plane = new Float32Array(frames);
        sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
        return plane;
      });
      for (let i = 0; i < frames; i += 1) {
        for (const plane of planes) sum += (plane[i] ?? 0) ** 2;
        count += planes.length;
        if (count >= window * planes.length) {
          out.push(sum > 0 ? 10 * Math.log10(sum / count) : -Infinity);
          sum = 0;
          count = 0;
        }
      }
    } finally {
      sample.close();
    }
  }
  return out;
}

/** Reads a file for Noise Reduction: the sound, the picture, and where to preview. */
export async function probeNoise(file: Blob): Promise<NoiseProbe> {
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      throw new MediaInputError(
        'This isn’t a file this tool can read. Try MP3, WAV, FLAC, OGG or M4A, or an MP4, MOV, WebM or MKV video.',
      );
    }
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new MediaInputError('This file has no sound to clean.');
    const video = (await input.getPrimaryVideoTrack()) !== null;
    const durationSec = await input.computeDuration();
    const codec = await track.getCodec();
    const sampleRate = await track.getSampleRate();
    const channels = await track.getNumberOfChannels();
    const canDecode = await track.canDecode();
    const server = await serverType(input, video);
    if (!server && !canDecode) {
      throw new MediaInputError(
        `This browser can’t decode the ${codecLabel(codec)} sound in this file, so it can’t send it. Try Chrome, Edge or Safari, or save the sound as WAV or MP3 first.`,
      );
    }
    const previewFrom =
      canDecode && durationSec > NOISE_PREVIEW_SECONDS
        ? pickStart(await levels(track, Math.min(durationSec, SCAN_SECONDS)), LEVEL_WINDOW_SEC)
        : 0;
    return {
      durationSec,
      video,
      serverType: server,
      sampleRate,
      channels,
      codec,
      canDecode,
      previewFrom,
      sendBytes: server ? file.size : flacBytes(durationSec, sampleRate, channels),
      summary: [
        codecLabel(codec),
        `${String(sampleRate / 1000)} kHz`,
        CHANNELS[channels] ?? `${String(channels)} channels`,
        clock(durationSec),
      ].join(' · '),
    };
  } finally {
    input.dispose();
  }
}

async function primarySound(input: Input): Promise<InputAudioTrack> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new MediaInputError('This file has no sound to clean.');
  if (!(await track.canDecode())) {
    throw new MediaInputError(
      `This browser can’t decode the ${codecLabel(await track.getCodec())} sound in this file.`,
    );
  }
  return track;
}

/**
 * The preview snippet: `seconds` of the sound from `from`, decoded, as 16-bit
 * WAV. It plays as "Original" and goes up for the preview.
 */
export async function previewSnippet(
  file: Blob,
  from: number,
  signal: AbortSignal,
  seconds = NOISE_PREVIEW_SECONDS,
): Promise<{ wav: Blob; from: number }> {
  const input = openInput(file);
  try {
    const track = await primarySound(input);
    const duration = await input.computeDuration();
    const start = Math.max(0, Math.min(from, duration - seconds));
    const out = await encodeAudio(
      {
        input,
        track,
        format: new WavOutputFormat(),
        codec: 'pcm-s16',
        start,
        end: Math.min(duration, start + seconds),
      },
      signal,
      () => undefined,
    );
    return { wav: new Blob([out.bytes], { type: 'audio/wav' }), from: start };
  } finally {
    input.dispose();
  }
}

/** The whole sound, decoded, as FLAC: what goes up for a video or audio our servers don't read. */
export async function soundAsFlac(
  file: Blob,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<Blob> {
  await ensureEncoder('flac');
  const input = openInput(file);
  try {
    const track = await primarySound(input);
    const out = await encodeAudio(
      { input, track, format: new FlacOutputFormat(), codec: 'flac' },
      signal,
      progress,
    );
    return new Blob([out.bytes], { type: 'audio/flac' });
  } finally {
    input.dispose();
  }
}

/** Frames kept behind the last read, for blocks that overlap a little. */
const KEEP_BEHIND = 48_000;

/**
 * The cleaned sound, read in order: each request is for the frames the
 * original had at that time, on the cleaned file's timeline from 0 (the FLAC
 * that went up started at 0, with any gap before the sound as silence). Only
 * a second or two is held at a time.
 */
export class CleanedReader {
  private readonly blocks: AsyncIterator<AudioSample>;
  /** Decoded blocks in order: their first frame and their planes. */
  private chunks: { at: number; planes: Float32Array[] }[] = [];
  /** The frame after the last one decoded. */
  private end = 0;
  private done = false;

  constructor(samples: AsyncIterable<AudioSample>) {
    this.blocks = samples[Symbol.asyncIterator]();
  }

  static of(track: InputAudioTrack): CleanedReader {
    return new CleanedReader(new AudioSampleSink(track).samples());
  }

  /** Decodes blocks until frame `until` is in, or the cleaned sound ends. */
  private async fill(until: number, channels: number): Promise<void> {
    while (!this.done && this.end < until) {
      const next = await this.blocks.next();
      if (next.done) {
        this.done = true;
        return;
      }
      const sample = next.value;
      try {
        const frames = sample.numberOfFrames;
        const planes = Array.from({ length: channels }, (_, c) => {
          const plane = new Float32Array(frames);
          sample.copyTo(plane, {
            planeIndex: Math.min(c, sample.numberOfChannels - 1),
            format: 'f32-planar',
          });
          return plane;
        });
        this.chunks.push({ at: this.end, planes });
        this.end += frames;
      } finally {
        sample.close();
      }
    }
  }

  /**
   * Frames `from` to `from + count`, per channel: fewer where the cleaned
   * sound ends first, null where it has none (or they were let go).
   */
  async read(from: number, count: number, channels: number): Promise<Float32Array[] | null> {
    await this.fill(from + count, channels);
    const first = this.chunks[0];
    if (!first || from < first.at || from >= this.end) return null;
    count = Math.min(count, this.end - from);
    const out = Array.from({ length: channels }, () => new Float32Array(count));
    for (const chunk of this.chunks) {
      const length = chunk.planes[0]?.length ?? 0;
      const lo = Math.max(from, chunk.at);
      const hi = Math.min(from + count, chunk.at + length);
      if (hi <= lo) continue;
      out.forEach((plane, c) => {
        plane.set(
          (chunk.planes[c] ?? new Float32Array(length)).subarray(lo - chunk.at, hi - chunk.at),
          lo - from,
        );
      });
    }
    while (this.chunks.length > 1) {
      const head = this.chunks[0];
      const next = this.chunks[1];
      if (!head || !next || next.at > from - KEEP_BEHIND) break;
      this.chunks.shift();
    }
    return out;
  }
}

/**
 * One block of the video's sound with the cleaned sound in it, frame for
 * frame: `at` is its first frame on the sound's timeline. Frames before 0
 * (an encoder's priming) and past the cleaned sound's end stay as they were.
 */
export async function cleanedBlock(
  original: Float32Array[],
  at: number,
  reader: Pick<CleanedReader, 'read'>,
): Promise<{ planes: Float32Array[]; replaced: number }> {
  const frames = original[0]?.length ?? 0;
  const skip = Math.min(frames, Math.max(0, -at));
  const cleaned =
    skip < frames ? await reader.read(at + skip, frames - skip, original.length) : null;
  if (!cleaned) return { planes: original, replaced: 0 };
  const planes = original.map((plane, c) => {
    const out = plane.slice();
    out.set(cleaned[c] ?? new Float32Array(0), skip);
    return out;
  });
  return { planes, replaced: cleaned[0]?.length ?? 0 };
}

/**
 * The video with its sound replaced by the cleaned sound: the picture and any
 * other sound tracks copied, the cleaned track encoded in the video's own
 * codec where this browser can, at the original's bitrate.
 */
export async function putSoundBack(
  video: Blob,
  cleaned: Blob,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<EngineOutput> {
  const input = openInput(video);
  const sound = openInput(cleaned);
  try {
    const track = await primarySound(input);
    const cleanedTrack = await primarySound(sound);
    const family = await sourceFamily(input);
    const format = containerFormat(family);
    const sourceCodec = await track.getCodec();
    const codec: AudioCodec | null =
      sourceCodec && (await getFirstEncodableAudioCodec([sourceCodec]))
        ? sourceCodec
        : await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs());
    if (!codec) {
      throw new MediaInputError(
        'This browser can’t encode sound for this video. Pick an audio format to get the cleaned sound on its own.',
      );
    }
    const bitrate = Math.max(
      128_000,
      (await track.getAverageBitrate().catch(() => null)) ?? (codec === 'opus' ? 128_000 : 192_000),
    );
    const reader = CleanedReader.of(cleanedTrack);
    let replaced = 0;
    let kept = 0;
    const out = await convert(
      {
        input,
        format,
        audio: (each) =>
          each === track
            ? {
                codec,
                bitrate: new Quality({ bitrate }),
                forceTranscode: true,
                process: async (sample: AudioSample) => {
                  if (signal.aborted) throw new EngineAbortError();
                  const frames = sample.numberOfFrames;
                  const channels = sample.numberOfChannels;
                  const original = Array.from({ length: channels }, (_, planeIndex) => {
                    const plane = new Float32Array(frames);
                    sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
                    return plane;
                  });
                  const at = Math.round(sample.timestamp * sample.sampleRate);
                  const block = await cleanedBlock(original, at, reader);
                  replaced += block.replaced;
                  kept += frames - block.replaced;
                  if (block.replaced === 0) return sample;
                  const planes = block.planes;
                  const data = new Float32Array(frames * channels);
                  planes.forEach((plane, c) => {
                    data.set(plane, c * frames);
                  });
                  const next = new AudioSample({
                    data,
                    format: 'f32-planar',
                    numberOfChannels: channels,
                    sampleRate: sample.sampleRate,
                    timestamp: sample.timestamp,
                  });
                  sample.close();
                  return next;
                },
              }
            : {},
      },
      signal,
      progress,
    );
    if (replaced === 0) throw new MediaInputError('The cleaned sound didn’t match this video.');
    const notes = [
      'The cleaned sound is back in the video, in sync; the picture is copied, not re-encoded',
      `Sound encoded as ${codecLabel(codec)} at ${String(Math.round(bitrate / 1000))} kbps`,
      ...(kept > replaced * 0.01
        ? ['A little of the original sound at the very start or end was kept as it was']
        : []),
      ...out.dropped,
    ];
    return {
      blob: new Blob([out.bytes], { type: out.mime }),
      ext: out.ext,
      path: 'Server · ffmpeg, then your browser',
      notes,
    };
  } finally {
    input.dispose();
    sound.dispose();
  }
}
