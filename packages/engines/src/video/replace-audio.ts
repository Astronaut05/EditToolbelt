/**
 * V14 Add or Replace Audio in Video (tools/video.md): music or any sound
 * under the picture. The video's packets are copied as they are, never
 * re-encoded. The new soundtrack is the music alone (Replace), or the music
 * mixed under the video's own sound (Mix): each at its level, the music
 * faded in and out, from a start point in it, looped or played once, and
 * exactly as long as the video. Both are brought to 48 kHz first.
 */
import { dbGain, musicEnd, musicGain, musicParts, Resampler, type MusicPart } from '@etb/core';
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  canEncodeAudio,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  Quality,
  type AudioCodec,
  type InputAudioTrack,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { codecLabel, MediaInputError, openInput } from './media';
import { containerFormat, sourceFamily } from './trim';

export interface ReplaceAudioOptions {
  /** The music or sound to add (the page passes the chosen file). */
  music?: Blob;
  /** replace or mix. */
  mode?: string;
  /** Replace: the music's level, dB. */
  level?: string;
  /** Mix: the music's level, and the video's own sound's, dB. */
  bedLevel?: string;
  videoLevel?: string;
  /** Seconds. */
  fadeIn?: string;
  fadeOut?: string;
  /** Where in the music to start, seconds. */
  offset?: string;
  /** loop or once: what happens when the music is shorter than the video. */
  loop?: string;
}

/** The soundtrack's rate: what Opus takes, and AAC's usual. */
export const MIX_RATE = 48_000;
/** Frames mixed and encoded at a time. */
const BLOCK = 4800;

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** A decoded block's frames `from`–`to` as planar floats, `channels` wide: mono goes to both sides; past stereo, the front two. */
function planesOf(sample: AudioSample, channels: number, from: number, to: number): Float32Array[] {
  const count = to - from;
  const read = (planeIndex: number) => {
    const plane = new Float32Array(count);
    sample.copyTo(plane, {
      planeIndex,
      format: 'f32-planar',
      frameOffset: from,
      frameCount: count,
    });
    return plane;
  };
  const own = Math.min(sample.numberOfChannels, channels);
  const planes = Array.from({ length: own }, (_, c) => read(c));
  while (planes.length < channels)
    planes.push(Float32Array.from(planes[0] ?? new Float32Array(count)));
  return planes;
}

/**
 * A track's frames at MIX_RATE, read in order: `parts` of it laid end to end
 * on the output timeline, each exactly as long as it should be; silence
 * after the last.
 */
async function* framesOf(
  track: InputAudioTrack,
  parts: MusicPart[],
  channels: number,
  signal: AbortSignal,
): AsyncGenerator<Float32Array[]> {
  const rate = await track.getSampleRate();
  for (const part of parts) {
    const want =
      Math.round((part.at + part.to - part.from) * MIX_RATE) - Math.round(part.at * MIX_RATE);
    let given = 0;
    const resampler = new Resampler(rate, MIX_RATE, channels);
    const cut = (planes: Float32Array[]) => {
      const n = Math.min(planes[0]?.length ?? 0, want - given);
      given += n;
      return planes.map((plane) => plane.subarray(0, n));
    };
    for await (const decoded of new AudioSampleSink(track).samples(part.from, part.to)) {
      if (signal.aborted) {
        decoded.close();
        throw new EngineAbortError();
      }
      const sr = decoded.sampleRate;
      const from = Math.max(0, Math.round((part.from - decoded.timestamp) * sr));
      const to = Math.min(decoded.numberOfFrames, Math.round((part.to - decoded.timestamp) * sr));
      if (to > from) {
        const planes = planesOf(decoded, channels, from, to);
        decoded.close();
        yield cut(resampler.push(planes));
      } else {
        decoded.close();
      }
    }
    yield cut(resampler.flush());
    // A decoder that stopped short: the rest of the part is silence, so the next starts on time.
    if (given < want) yield Array.from({ length: channels }, () => new Float32Array(want - given));
  }
}

/** Takes frames from a stream in whatever sizes it gives them; silence once it ends. */
class Frames {
  private block: Float32Array[] | null = null;
  private used = 0;
  private source: AsyncGenerator<Float32Array[]> | null;
  private readonly channels: number;

  constructor(source: AsyncGenerator<Float32Array[]> | null, channels: number) {
    this.source = source;
    this.channels = channels;
  }

  async take(n: number): Promise<Float32Array[]> {
    const out = Array.from({ length: this.channels }, () => new Float32Array(n));
    let filled = 0;
    while (filled < n) {
      const length = this.block?.[0]?.length ?? 0;
      if (!this.block || this.used >= length) {
        if (!this.source) break;
        const next = await this.source.next();
        if (next.done) {
          this.source = null;
          break;
        }
        this.block = next.value;
        this.used = 0;
        continue;
      }
      const k = Math.min(n - filled, length - this.used);
      for (let c = 0; c < this.channels; c += 1) {
        out[c]?.set(
          (this.block[c] ?? new Float32Array(length)).subarray(this.used, this.used + k),
          filled,
        );
      }
      filled += k;
      this.used += k;
    }
    return out;
  }
}

/** The codec to write: the container's usual one, if this browser can encode it. */
async function soundtrackCodec(mime: string): Promise<AudioCodec> {
  const isobmff = mime === 'video/mp4' || mime === 'video/quicktime';
  const codec: AudioCodec = isobmff ? 'aac' : 'opus';
  if (!(await canEncodeAudio(codec, { sampleRate: MIX_RATE, numberOfChannels: 2 }))) {
    throw new MediaInputError(
      isobmff
        ? 'This browser can’t encode AAC audio for an MP4 or MOV. Try Chrome, Edge or Safari on a computer.'
        : `This browser can’t encode ${codecLabel(codec)} audio. Try Chrome, Edge or Firefox.`,
    );
  }
  return codec;
}

const secs = (t: number) => `${t.toFixed(t < 10 ? 2 : 1)} s`;

export const replaceAudioEngine: Engine<ReplaceAudioOptions> = {
  ...MEDIA_META.replaceAudio,
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (!opts.music) throw new MediaInputError('Choose the music or sound to add.');
    const input = openInput(file);
    const musicInput = openInput(opts.music);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video in it.');
      const music = await musicInput.getPrimaryAudioTrack();
      if (!music) throw new MediaInputError('The music file has no audio in it.');
      if (!(await music.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the music’s ${codecLabel(await music.getCodec())} audio. Try an MP3, WAV or M4A.`,
        );
      }
      const mix = opts.mode === 'mix';
      const own = mix ? await input.getPrimaryAudioTrack() : null;
      if (own && !(await own.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the video’s ${codecLabel(await own.getCodec())} sound, so it can’t mix it. Replace still works.`,
        );
      }
      const family = await sourceFamily(input);
      const format = containerFormat(family);
      const codec = await soundtrackCodec(format.mimeType);

      const length = await video.computeDuration();
      const musicLength = await music.computeDuration();
      const offset = Math.max(0, num(opts.offset, 0));
      if (offset >= musicLength) {
        throw new MediaInputError(
          `The music is ${secs(musicLength)} long, so it can’t start at ${secs(offset)}.`,
        );
      }
      const loop = opts.loop !== 'once';
      const parts = musicParts(musicLength, offset, length, loop);
      const end = musicEnd(parts);
      if (loop && end < length - 0.01) {
        throw new MediaInputError(
          `A ${secs(musicLength)} sound would repeat over ${String(parts.length)} times under this video. Play it once, or choose a longer one.`,
        );
      }
      const gain = {
        level: dbGain(num(mix ? opts.bedLevel : opts.level, mix ? -15 : 0)),
        fadeIn: Math.max(0, num(opts.fadeIn, 0)),
        fadeOut: Math.max(0, num(opts.fadeOut, 0)),
        end,
        repeats: parts.slice(1).map((p) => p.at),
      };
      const videoGain = dbGain(num(opts.videoLevel, 0));
      const channels = Math.min(
        2,
        Math.max(await music.getNumberOfChannels(), own ? await own.getNumberOfChannels() : 1),
      );

      const target = new BufferTarget();
      const output = new Output({ format, target });
      output.setMetadataTags(await input.getMetadataTags());
      const packets = new EncodedVideoPacketSource((await video.getCodec()) ?? 'avc');
      output.addVideoTrack(packets, {
        ...(format.supportsVideoTransformationMetadata && {
          transformationMatrix: await video.getTransformationMatrix(),
        }),
      });
      const audio = new AudioSampleSource({
        codec,
        quality: new Quality({ bitrate: channels === 2 ? 192_000 : 128_000 }),
      });
      output.addAudioTrack(audio);
      await output.start();

      const total = Math.round(length * MIX_RATE);
      let clipped = 0;
      const writeVideo = async () => {
        const config = await video.getDecoderConfig();
        let first = true;
        for await (const packet of new EncodedPacketSink(video).packets()) {
          if (ctx.signal.aborted) throw new EngineAbortError();
          await packets.add(packet, first && config ? { decoderConfig: config } : undefined);
          first = false;
        }
        packets.close();
      };
      const writeAudio = async () => {
        const bed = new Frames(framesOf(music, parts, channels, ctx.signal), channels);
        const original = own
          ? new Frames(
              framesOf(own, [{ from: 0, to: length, at: 0 }], channels, ctx.signal),
              channels,
            )
          : null;
        for (let at = 0; at < total; at += BLOCK) {
          if (ctx.signal.aborted) throw new EngineAbortError();
          const n = Math.min(BLOCK, total - at);
          const planes = await bed.take(n);
          const under = original ? await original.take(n) : null;
          for (let i = 0; i < n; i += 1) {
            const g = musicGain((at + i) / MIX_RATE, gain);
            for (let c = 0; c < channels; c += 1) {
              const plane = planes[c];
              if (!plane) continue;
              let v = (plane[i] ?? 0) * g + (under?.[c]?.[i] ?? 0) * videoGain;
              if (v > 1 || v < -1) {
                clipped += 1;
                v = v > 1 ? 1 : -1;
              }
              plane[i] = v;
            }
          }
          const data = new Float32Array(n * channels);
          planes.forEach((plane, c) => {
            data.set(plane, c * n);
          });
          const sample = new AudioSample({
            data,
            format: 'f32-planar',
            numberOfChannels: channels,
            sampleRate: MIX_RATE,
            timestamp: at / MIX_RATE,
          });
          await audio.add(sample);
          sample.close();
          ctx.progress((at + n) / total, mix ? 'Mixing the sound' : 'Adding the sound');
        }
        audio.close();
      };
      try {
        await Promise.all([writeVideo(), writeAudio()]);
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        if (ctx.signal.aborted) throw new EngineAbortError();
        throw error;
      }
      const bytes = target.buffer;
      if (!bytes) throw new Error('No file was written');

      const notes = [
        mix
          ? own
            ? 'The music is mixed under the video’s own sound'
            : 'This video had no sound of its own, so the music is its only sound'
          : 'The video’s sound is replaced by the music',
        `The picture is copied, not re-encoded; the sound is ${codecLabel(codec)} at 48 kHz, ${channels === 2 ? 'stereo' : 'mono'}`,
      ];
      if (end < length - 0.01) {
        notes.push(
          own
            ? `The music ends at ${secs(end)}; the video’s own sound carries on`
            : `The music ends at ${secs(end)}; the rest of the video is silent`,
        );
      } else if (parts.length > 1) {
        notes.push(
          `The music loops ${String(parts.length - 1)} ${parts.length === 2 ? 'time' : 'times'} to fill ${secs(length)}`,
        );
      }
      if (clipped > 0) {
        notes.push('The mix went over 0 dBFS in places and was clipped there: lower a level');
      }
      return {
        blob: new Blob([bytes], { type: format.mimeType }),
        ext: format.fileExtension.slice(1),
        durationSec: length,
        path: 'Browser · WebCodecs',
        notes,
        details: [
          { label: 'Sound', value: mix ? 'Mixed' : 'Replaced' },
          { label: 'Length', value: secs(length) },
        ],
      };
    } finally {
      input.dispose();
      musicInput.dispose();
    }
  },
};
