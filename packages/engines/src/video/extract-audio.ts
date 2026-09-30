/**
 * V06 Extract Audio. When the chosen format holds the source codec as it is
 * (AAC into M4A or AAC, Opus into OGG, MP3 into MP3, FLAC into FLAC), the
 * packets are copied: no quality lost, done in a moment. Otherwise the audio
 * is decoded and encoded. MP3 and FLAC encoders (LAME, libFLAC as WASM) load
 * only when those formats are picked (docs/13: LAME is LGPL, so it stays its
 * own file).
 */
import {
  AdtsOutputFormat,
  canEncodeAudio,
  EncodedPacketSink,
  FlacOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Quality,
  WavOutputFormat,
  type AudioCodec,
  type OutputFormat,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import type { Engine, EngineOutput, RunContext } from '../types';
import { readAacConfig, toAdts } from './adts';
import { encodeAudio } from './encode-audio';
import { codecLabel, convert, MediaInputError, openInput } from './media';
import { checkRange } from './trim';
import { MEDIA_META } from '../media-meta';

export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'aac' | 'flac' | 'ogg';

export interface ExtractAudioOptions {
  format?: string;
  /** kbps, for MP3, M4A, AAC and OGG. */
  bitrate?: string;
  /** keep, 44100 or 48000 */
  sampleRate?: string;
  /** 1-based audio track number. */
  track?: string | number;
  start?: number;
  end?: number;
}

interface Target {
  codec: AudioCodec;
  format: () => OutputFormat;
  ext: string;
  mime: string;
  lossy: boolean;
}

export const AUDIO_TARGETS: Record<AudioFormat, Target> = {
  mp3: {
    codec: 'mp3',
    format: () => new Mp3OutputFormat(),
    ext: 'mp3',
    mime: 'audio/mpeg',
    lossy: true,
  },
  wav: {
    codec: 'pcm-s16',
    format: () => new WavOutputFormat(),
    ext: 'wav',
    mime: 'audio/wav',
    lossy: false,
  },
  m4a: {
    codec: 'aac',
    format: () => new Mp4OutputFormat({ fastStart: 'in-memory' }),
    ext: 'm4a',
    mime: 'audio/mp4',
    lossy: true,
  },
  aac: {
    codec: 'aac',
    format: () => new AdtsOutputFormat(),
    ext: 'aac',
    mime: 'audio/aac',
    lossy: true,
  },
  flac: {
    codec: 'flac',
    format: () => new FlacOutputFormat(),
    ext: 'flac',
    mime: 'audio/flac',
    lossy: false,
  },
  ogg: {
    codec: 'opus',
    format: () => new OggOutputFormat(),
    ext: 'ogg',
    mime: 'audio/ogg',
    lossy: true,
  },
};

/**
 * MP3 and FLAC always use our own encoders (LAME, libFLAC), even where the
 * browser has one: WebKit's GStreamer MP3 encoder ignores the bitrate and
 * drops the last frames. AAC and Opus come only from the browser.
 */
export async function ensureEncoder(codec: AudioCodec): Promise<void> {
  if (codec === 'mp3') {
    const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
    registerMp3Encoder();
    return;
  }
  if (codec === 'flac') {
    const { registerFlacEncoder } = await import('@mediabunny/flac-encoder');
    registerFlacEncoder();
    return;
  }
  if (await canEncodeAudio(codec)) return;
  if (codec === 'aac') {
    throw new MediaInputError(
      'This browser can’t encode AAC, so it can’t make an M4A from this audio. Pick MP3 or WAV, or use Chrome on Windows or macOS, Safari or Edge.',
    );
  } else if (codec === 'opus') {
    throw new MediaInputError('This browser can’t encode Opus for OGG. Pick MP3 or WAV.');
  }
}

export const extractAudioEngine: Engine<ExtractAudioOptions> = {
  ...MEDIA_META.extractAudio,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const format: AudioFormat =
      opts.format && opts.format in AUDIO_TARGETS ? (opts.format as AudioFormat) : 'mp3';
    const target = AUDIO_TARGETS[format];
    const input = openInput(file);
    try {
      const tracks = await input.getAudioTracks();
      if (tracks.length === 0) {
        throw new MediaInputError('This video has no audio track, so there is nothing to extract.');
      }
      const wanted = Math.min(Math.max(1, Number(opts.track) || 1), tracks.length);
      const source = tracks[wanted - 1];
      if (!source) throw new MediaInputError('That audio track isn’t in this file.');
      const duration = await input.computeDuration();
      const ranged = opts.start !== undefined || opts.end !== undefined;
      const [start, end] = ranged
        ? checkRange(opts.start ?? 0, opts.end ?? duration, duration)
        : [0, duration];
      const sourceCodec = await source.getCodec();
      const sourceRate = await source.getSampleRate();
      const sampleRate = Number(opts.sampleRate);
      const resample = Number.isFinite(sampleRate) && sampleRate > 0 && sampleRate !== sourceRate;
      const copy = sourceCodec === target.codec && !resample;
      if (!copy) {
        if (!(await source.canDecode())) {
          throw new MediaInputError(
            `This browser can’t decode the ${codecLabel(sourceCodec)} audio in this file.`,
          );
        }
        await ensureEncoder(target.codec);
      }
      const kbps = Number(opts.bitrate) || 192;
      const adts =
        format === 'aac' && copy ? await copyToAdts(source, start, end, duration, ctx) : null;
      const progress = (f: number) => {
        ctx.progress(f, copy ? 'Copying the audio' : `Encoding ${target.ext.toUpperCase()}`);
      };
      const out = adts
        ? { bytes: adts.buffer }
        : copy
          ? await convert(
              {
                input,
                format: target.format(),
                ...(ranged && { trim: { start, end } }),
                video: { discard: true },
                audio: (track) => (track === source ? { codec: target.codec } : { discard: true }),
              },
              ctx.signal,
              progress,
            )
          : await encodeAudio(
              {
                input,
                track: source,
                format: target.format(),
                codec: target.codec,
                start,
                end,
                ...(resample && { sampleRate }),
                ...(target.lossy && { quality: new Quality({ bitrate: kbps * 1000 }) }),
              },
              ctx.signal,
              progress,
            );
      const notes = [
        copy
          ? `Copied without re-encoding: the ${codecLabel(sourceCodec)} audio is unchanged`
          : `Encoded as ${codecLabel(target.codec === 'pcm-s16' ? 'PCM' : target.codec)}${target.lossy ? ` at ${String(kbps)} kbps` : ''}${resample ? `, ${String(sampleRate / 1000)} kHz` : ''}`,
        ...(tracks.length > 1 ? [`Audio track ${String(wanted)} of ${String(tracks.length)}`] : []),
      ];
      return {
        blob: new Blob([out.bytes], { type: target.mime }),
        ext: target.ext,
        durationSec: end - start,
        path: copy ? 'Browser · stream copy' : 'Browser · WebCodecs',
        notes,
        details: [
          { label: 'Audio', value: `${codecLabel(sourceCodec)} → ${target.ext.toUpperCase()}` },
          { label: 'Length', value: `${(end - start).toFixed(1)} s` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};

type AudioTrack = Awaited<ReturnType<ReturnType<typeof openInput>['getAudioTracks']>>[number];

/** AAC out of an MP4 into a raw .aac file: the same frames, each behind an ADTS header. */
async function copyToAdts(
  track: AudioTrack,
  start: number,
  end: number,
  duration: number,
  ctx: RunContext,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const description = (await track.getDecoderConfig())?.description;
  if (!description) return null;
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  const config = readAacConfig(bytes);
  if (!config) return null;
  const frames: Uint8Array[] = [];
  for await (const packet of new EncodedPacketSink(track).packets()) {
    if (ctx.signal.aborted) throw new EngineAbortError();
    if (packet.timestamp + packet.duration <= start || packet.timestamp >= end) continue;
    frames.push(packet.data);
    if (frames.length % 500 === 0) ctx.progress(packet.timestamp / duration, 'Copying the audio');
  }
  return toAdts(config, frames);
}
