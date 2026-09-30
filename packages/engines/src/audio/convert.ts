/**
 * A01 Audio Converter (tools/audio.md): any audio (or a video's sound) to
 * MP3, WAV, FLAC, OGG/Opus or M4A/AAC, with sample rate, bit depth and
 * channels. The browser decodes (WebCodecs) and encodes where it can; MP3 and
 * FLAC use our own lazy-loaded encoders. A file already in the target codec
 * with nothing to change is copied, not re-encoded. Tags are kept.
 */
import { Quality, type AudioCodec } from 'mediabunny';

import type { Engine, EngineOutput } from '../types';
import { encodeAudio } from '../video/encode-audio';
import { AUDIO_TARGETS, ensureEncoder, type AudioFormat } from '../video/extract-audio';
import { codecLabel, convert, MediaInputError, openInput } from '../video/media';
import { AUDIO_LIMITS, MEDIA_META } from '../media-meta';

export interface AudioConverterOptions {
  format?: string;
  /** kbps for MP3, M4A and OGG. */
  bitrate?: string;
  /** keep, 44100, 48000 or 96000 */
  sampleRate?: string;
  /** 16 or 24, for WAV. */
  bitDepth?: string;
  /** keep, 1 or 2 */
  channels?: string;
}

/** tools/audio.md → Limits: long recordings are fine, but not a whole day. */
export { AUDIO_LIMITS };

const kHz = (rate: number) => `${String(rate / 1000)} kHz`;
const CHANNEL_NAMES: Record<number, string> = { 1: 'mono', 2: 'stereo' };

export const audioConverterEngine: Engine<AudioConverterOptions> = {
  ...MEDIA_META.audioConverter,
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > AUDIO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
    }
    const format: AudioFormat =
      opts.format && opts.format in AUDIO_TARGETS ? (opts.format as AudioFormat) : 'mp3';
    const target = AUDIO_TARGETS[format];
    const input = openInput(file);
    try {
      if (!(await input.canRead())) {
        throw new MediaInputError(
          'This isn’t an audio file this tool can read. Try MP3, WAV, FLAC, OGG, M4A or AAC.',
        );
      }
      const source = await input.getPrimaryAudioTrack();
      if (!source) throw new MediaInputError('This file has no audio in it.');
      const duration = await input.computeDuration();
      if (duration > AUDIO_LIMITS.maxSeconds) {
        throw new MediaInputError('This file is over 4 hours long, the browser limit for audio.');
      }
      const sourceCodec = await source.getCodec();
      const sourceRate = await source.getSampleRate();
      const sourceChannels = await source.getNumberOfChannels();
      const wantedRate = Number(opts.sampleRate);
      const resample = Number.isFinite(wantedRate) && wantedRate > 0 && wantedRate !== sourceRate;
      const wantedChannels = Number(opts.channels);
      const remix =
        (wantedChannels === 1 || wantedChannels === 2) && wantedChannels !== sourceChannels;
      // WAV at 24 bits is its own PCM codec; everything else keeps the target's.
      const codec: AudioCodec =
        format === 'wav' && opts.bitDepth === '24' ? 'pcm-s24' : target.codec;
      const copy = sourceCodec === codec && !resample && !remix;
      if (!copy) {
        if (!(await source.canDecode())) {
          throw new MediaInputError(
            `This browser can’t decode the ${codecLabel(sourceCodec)} audio in this file.`,
          );
        }
        await ensureEncoder(codec);
      }
      const kbps = Number(opts.bitrate) || 192;
      const progress = (f: number) => {
        ctx.progress(f, copy ? 'Copying' : `Encoding ${target.ext.toUpperCase()}`);
      };
      const out = copy
        ? await convert(
            {
              input,
              format: target.format(),
              video: { discard: true },
              audio: (track) => (track === source ? { codec } : { discard: true }),
            },
            ctx.signal,
            progress,
          )
        : {
            ...(await encodeAudio(
              {
                input,
                track: source,
                format: target.format(),
                codec,
                ...(resample && { sampleRate: wantedRate }),
                ...(remix && { numberOfChannels: wantedChannels }),
                ...(target.lossy && { quality: new Quality({ bitrate: kbps * 1000 }) }),
              },
              ctx.signal,
              progress,
            )),
            dropped: [],
          };
      const rate = resample ? wantedRate : sourceRate;
      const channels = remix ? wantedChannels : sourceChannels;
      const codecName = codec.startsWith('pcm')
        ? `PCM ${codec === 'pcm-s24' ? '24' : '16'}-bit`
        : codecLabel(codec);
      const notes = [
        copy
          ? `Copied without re-encoding: the ${codecLabel(sourceCodec)} audio is unchanged`
          : `Encoded as ${codecName}${target.lossy ? ` at ${String(kbps)} kbps` : ''}, ${kHz(rate)}, ${CHANNEL_NAMES[channels] ?? `${String(channels)} channels`}`,
        ...(resample ? [`Sample rate changed from ${kHz(sourceRate)} to ${kHz(rate)}`] : []),
        ...(remix
          ? [
              channels === 1
                ? `Mixed down to mono from ${String(sourceChannels)} channels`
                : 'Mono copied to both sides for stereo',
            ]
          : []),
        ...out.dropped,
      ];
      return {
        blob: new Blob([out.bytes], { type: target.mime }),
        ext: target.ext,
        durationSec: duration,
        path: copy ? 'Browser · stream copy' : 'Browser · WebCodecs',
        notes,
        details: [
          { label: 'Audio', value: `${codecLabel(sourceCodec)} → ${target.ext.toUpperCase()}` },
          { label: 'Sample rate', value: kHz(rate) },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
