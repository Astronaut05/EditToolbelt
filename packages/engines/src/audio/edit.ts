/**
 * A07 Fade In / Fade Out and A13 Audio Channel Tools (tools/audio.md): the
 * track is decoded, each block changed on the way through (@etb/core does
 * the maths) and encoded again, in its own format unless another is picked.
 */
import {
  applyFades,
  channelActionOf,
  ChannelStats,
  channelVerdict,
  fadeCurveOf,
  needsStereo,
  remix,
  VERDICTS,
  type ChannelAction,
  type ChannelVerdict,
} from '@etb/core';
import { zipSync } from 'fflate';
import { AudioSample, AudioSampleSink, Quality, type AudioCodec } from 'mediabunny';

import type { Engine, EngineOutput } from '../types';
import { encodeAudio } from '../video/encode-audio';
import {
  AUDIO_TARGETS,
  type AudioFormat,
  ensureEncoder,
  KEEP_FORMAT,
} from '../video/extract-audio';
import { codecLabel, MediaInputError, openInput } from '../video/media';
import { AUDIO_LIMITS, MEDIA_META } from '../media-meta';
import { safeStem } from '../names';

/** A file name without its extension, safe for the names inside a ZIP. */
function stemOf(name: string): string {
  return safeStem(name, 'audio');
}

function planesOf(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
    return plane;
  });
}

function sampleOf(planes: Float32Array[], like: AudioSample): AudioSample {
  const frames = planes[0]?.length ?? 0;
  const data = new Float32Array(frames * planes.length);
  planes.forEach((plane, c) => {
    data.set(plane, c * frames);
  });
  return new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: planes.length,
    sampleRate: like.sampleRate,
    timestamp: like.timestamp,
  });
}

interface Source {
  rate: number;
  channels: number;
  durationSec: number;
  codec: AudioCodec | null;
}

/** Opens a file's audio and checks it against the browser limits. */
async function source(file: Blob): Promise<Source> {
  if (file.size > AUDIO_LIMITS.maxBytes) {
    throw new MediaInputError('This file is over 1 GB, the browser limit for audio.');
  }
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      throw new MediaInputError(
        'This isn’t an audio file this tool can read. Try MP3, WAV, FLAC, OGG or M4A.',
      );
    }
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new MediaInputError('This file has no audio in it.');
    const codec = await track.getCodec();
    if (!(await track.canDecode())) {
      throw new MediaInputError(
        `This browser can’t decode the ${codecLabel(codec)} audio in this file.`,
      );
    }
    const durationSec = await track.computeDuration();
    if (durationSec > AUDIO_LIMITS.maxSeconds) {
      throw new MediaInputError('This file is over 4 hours long, the browser limit for audio.');
    }
    return {
      rate: await track.getSampleRate(),
      channels: await track.getNumberOfChannels(),
      durationSec,
      codec,
    };
  } finally {
    input.dispose();
  }
}

/** The format and codec to write: the source's own unless another is picked. */
function outputOf(format: string | undefined, sourceCodec: AudioCodec | null) {
  const keep = sourceCodec ? KEEP_FORMAT[sourceCodec] : undefined;
  const chosen: AudioFormat =
    format && format in AUDIO_TARGETS ? (format as AudioFormat) : (keep ?? 'wav');
  const target = AUDIO_TARGETS[chosen];
  const codec: AudioCodec =
    chosen === 'wav' && sourceCodec?.startsWith('pcm') ? sourceCodec : target.codec;
  return { target, codec };
}

/** Decodes, changes each block with `change` (planes and the first frame's index), encodes. */
async function rewrite(
  file: Blob,
  output: ReturnType<typeof outputOf>,
  change: (planes: Float32Array[], start: number) => Float32Array[],
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<ArrayBuffer> {
  await ensureEncoder(output.codec);
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new MediaInputError('This file has no audio in it.');
    const bitrate = output.target.lossy
      ? ((await track.getAverageBitrate().catch(() => null)) ?? 192_000)
      : null;
    const out = await encodeAudio(
      {
        input,
        track,
        format: output.target.format(),
        codec: output.codec,
        ...(bitrate && { quality: new Quality({ bitrate }) }),
        process: (sample) => {
          const planes = change(planesOf(sample), Math.round(sample.timestamp * sample.sampleRate));
          const next = sampleOf(planes, sample);
          sample.close();
          return next;
        },
      },
      signal,
      progress,
    );
    return out.bytes;
  } finally {
    input.dispose();
  }
}

const reencoded = (output: ReturnType<typeof outputOf>) =>
  output.target.lossy
    ? `Re-encoded as ${codecLabel(output.codec)} at the file's own bitrate`
    : `${codecLabel(output.codec.startsWith('pcm') ? 'PCM' : output.codec)}: lossless`;

export interface FadeOptions {
  /** Seconds. */
  fadeIn?: string;
  fadeOut?: string;
  /** linear, exponential, logarithmic or s-curve. */
  inCurve?: string;
  outCurve?: string;
  format?: string;
}

const CURVE_NAMES: Record<string, string> = {
  linear: 'linear',
  exponential: 'exponential',
  logarithmic: 'logarithmic',
  's-curve': 'S-curve',
};

export const fadeEngine: Engine<FadeOptions> = {
  ...MEDIA_META.audioEdit,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const src = await source(file);
    const fadeIn = Math.max(0, Number(opts.fadeIn) || 0);
    const fadeOut = Math.max(0, Number(opts.fadeOut) || 0);
    if (fadeIn === 0 && fadeOut === 0) {
      throw new MediaInputError('Set a fade in or a fade out longer than 0 s.');
    }
    if (fadeIn + fadeOut > src.durationSec) {
      throw new MediaInputError(
        `The fades add up to ${String(fadeIn + fadeOut)} s; the audio is ${src.durationSec.toFixed(1)} s. Shorten them.`,
      );
    }
    const inCurve = fadeCurveOf(opts.inCurve);
    const outCurve = fadeCurveOf(opts.outCurve);
    const fades = {
      inFrames: Math.round(fadeIn * src.rate),
      outFrames: Math.round(fadeOut * src.rate),
      inCurve,
      outCurve,
      total: Math.round(src.durationSec * src.rate),
    };
    const output = outputOf(opts.format, src.codec);
    const bytes = await rewrite(
      file,
      output,
      (planes, start) => {
        applyFades(planes, start, fades);
        return planes;
      },
      ctx.signal,
      (f) => {
        ctx.progress(f, 'Fading');
      },
    );
    return {
      blob: new Blob([bytes], { type: output.target.mime }),
      ext: output.target.ext,
      durationSec: src.durationSec,
      path: 'Browser · WebCodecs',
      notes: [
        ...(fadeIn > 0 ? [`Fade in: ${String(fadeIn)} s, ${CURVE_NAMES[inCurve] ?? inCurve}`] : []),
        ...(fadeOut > 0
          ? [`Fade out: ${String(fadeOut)} s, ${CURVE_NAMES[outCurve] ?? outCurve}`]
          : []),
        reencoded(output),
      ],
      details: [
        { label: 'Fade in', value: fadeIn > 0 ? `${String(fadeIn)} s` : 'None' },
        { label: 'Fade out', value: fadeOut > 0 ? `${String(fadeOut)} s` : 'None' },
      ],
    };
  },
};

/** How much of a file the channel check reads, seconds: enough to tell, quickly. */
const CHECK_SECONDS = 120;

/**
 * Reads up to the first two minutes and says what the two sides hold, for
 * the page to suggest the fix as the file arrives.
 */
export async function probeChannels(
  file: Blob,
): Promise<{ channels: number; verdict: ChannelVerdict | null }> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return { channels: 0, verdict: null };
    const channels = await track.getNumberOfChannels();
    if (channels !== 2) return { channels, verdict: null };
    const stats = new ChannelStats();
    for await (const sample of new AudioSampleSink(track).samples(0, CHECK_SECONDS)) {
      stats.push(planesOf(sample));
      sample.close();
    }
    return { channels, verdict: channelVerdict(stats.result()) };
  } finally {
    input.dispose();
  }
}

export interface ChannelOptions {
  action?: string;
  format?: string;
}

/** The download name's suffix for each action. */
const SUFFIX: Record<ChannelAction, string> = {
  'mono-sum': 'mono',
  'mono-left': 'mono',
  'mono-right': 'mono',
  stereo: 'stereo',
  'left-both': 'fixed',
  'right-both': 'fixed',
  swap: 'swapped',
  'invert-left': 'inverted',
  'invert-right': 'inverted',
  split: 'split',
};

const ACTION_NOTES: Record<ChannelAction, string> = {
  'mono-sum': 'Mixed to mono: left and right summed, at half each so it never clips',
  'mono-left': 'Mono from the left channel',
  'mono-right': 'Mono from the right channel',
  stereo: 'Stereo: the mono channel on both sides',
  'left-both': 'The left channel on both sides',
  'right-both': 'The right channel on both sides',
  swap: 'Left and right swapped',
  'invert-left': 'The left channel’s phase inverted',
  'invert-right': 'The right channel’s phase inverted',
  split: 'Split into two mono files, left and right',
};

export const channelsEngine: Engine<ChannelOptions> = {
  ...MEDIA_META.audioEdit,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const src = await source(file);
    const action = channelActionOf(opts.action);
    if (src.channels > 2) {
      throw new MediaInputError(
        `This file has ${String(src.channels)} channels; these tools work on mono and stereo.`,
      );
    }
    if (needsStereo(action) && src.channels !== 2) {
      throw new MediaInputError('This file is mono: there are no left and right to work with.');
    }
    if (!needsStereo(action) && src.channels !== 1) {
      throw new MediaInputError('This file is already stereo.');
    }
    const output = outputOf(opts.format, src.codec);
    const stats = new ChannelStats();
    const name = file instanceof File ? file.name : 'audio';
    if (action === 'split') {
      const sides: ArrayBuffer[] = [];
      for (const [index, side] of (['mono-left', 'mono-right'] as const).entries()) {
        sides.push(
          await rewrite(
            file,
            output,
            (planes) => {
              if (index === 0) stats.push(planes);
              return remix(planes, side);
            },
            ctx.signal,
            (f) => {
              ctx.progress((index + f) / 2, index === 0 ? 'Left channel' : 'Right channel');
            },
          ),
        );
      }
      const stem = stemOf(name);
      const ext = output.target.ext;
      const zip = zipSync({
        [`${stem}_L.${ext}`]: [new Uint8Array(sides[0] ?? new ArrayBuffer(0)), { level: 0 }],
        [`${stem}_R.${ext}`]: [new Uint8Array(sides[1] ?? new ArrayBuffer(0)), { level: 0 }],
      });
      return {
        blob: new Blob([zip.slice().buffer], { type: 'application/zip' }),
        ext: 'zip',
        nameSuffix: SUFFIX.split,
        durationSec: src.durationSec,
        path: 'Browser · WebCodecs',
        notes: [
          ACTION_NOTES.split,
          VERDICTS[channelVerdict(stats.result())].text,
          reencoded(output),
        ],
        details: [{ label: 'Files', value: `${stem}_L.${ext}, ${stem}_R.${ext}` }],
      };
    }
    const bytes = await rewrite(
      file,
      output,
      (planes) => {
        if (src.channels === 2) stats.push(planes);
        return remix(planes, action);
      },
      ctx.signal,
      (f) => {
        ctx.progress(f, 'Remixing');
      },
    );
    const outChannels = ['mono-sum', 'mono-left', 'mono-right'].includes(action) ? 1 : 2;
    return {
      blob: new Blob([bytes], { type: output.target.mime }),
      ext: output.target.ext,
      nameSuffix: SUFFIX[action],
      durationSec: src.durationSec,
      path: 'Browser · WebCodecs',
      notes: [
        ACTION_NOTES[action],
        ...(src.channels === 2 ? [`Before: ${VERDICTS[channelVerdict(stats.result())].text}`] : []),
        reencoded(output),
      ],
      details: [{ label: 'Channels', value: outChannels === 1 ? 'Mono' : 'Stereo' }],
    };
  },
};
