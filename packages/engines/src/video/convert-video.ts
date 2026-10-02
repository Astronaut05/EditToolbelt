/**
 * V03 Video Converter (tools/video.md): a new container, remuxed when the
 * tracks already fit it (instant, nothing re-encoded), re-encoded only where
 * they don't. "Fit" means what plays where that container is used, not just
 * what it can hold: VP9 can sit in an MP4, but QuickTime and editing apps
 * won't play it, so MKV (VP9) → MP4 re-encodes to H.264. The browser path
 * reads MP4, MOV, WebM and MKV; AVI and codecs the browser can't decode
 * (ProRes, DNxHD) need the server path, which comes later.
 */
import {
  canEncodeAudio,
  canEncodeVideo,
  EncodedPacketSink,
  Quality,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';

import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { codecLabel, convert, MediaInputError, openInput } from './media';
import { containerFormat } from './trim';

export type Family = 'mp4' | 'mov' | 'webm' | 'mkv';

export interface VideoConverterOptions {
  /** mp4, webm, mov or mkv */
  format?: string;
  /** keep (remux whenever the codecs fit) or reencode */
  mode?: string;
  /** auto, avc, hevc, av1 or vp9: the video codec when re-encoding */
  codec?: string;
}

/** What each container is expected to hold, for a copy that plays where that container is used. */
const FITS: Record<Family, { video: string[]; audio: string[] }> = {
  mp4: { video: ['avc', 'hevc', 'av1'], audio: ['aac', 'mp3', 'ac3', 'eac3'] },
  mov: {
    video: ['avc', 'hevc', 'prores'],
    audio: ['aac', 'mp3', 'ac3', 'eac3', 'pcm-s16', 'pcm-s16be', 'pcm-s24', 'pcm-s24be', 'pcm-f32'],
  },
  webm: { video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'] },
  mkv: {
    video: ['avc', 'hevc', 'vp8', 'vp9', 'av1'],
    audio: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3', 'pcm-s16', 'pcm-s24', 'pcm-f32'],
  },
};

/** The codecs a re-encode writes into each container, best first. */
const ENCODE: Record<Family, { video: VideoCodec[]; audio: AudioCodec[] }> = {
  mp4: { video: ['avc', 'hevc', 'av1'], audio: ['aac'] },
  mov: { video: ['avc', 'hevc'], audio: ['aac'] },
  webm: { video: ['vp9', 'av1', 'vp8'], audio: ['opus'] },
  mkv: { video: ['avc', 'vp9', 'hevc', 'av1'], audio: ['aac', 'opus'] },
};

export type TrackPlan = { copy: true } | { copy: false; codec: string };

export interface ConversionPlan {
  container: Family;
  video: TrackPlan | null;
  audio: TrackPlan | null;
  notes: string[];
}

/**
 * Copy or re-encode, track by track. `canEncode` says what this browser's
 * encoders can write. When MP4 or MOV can't get an H.264 or AAC encode here,
 * the file becomes WebM, and the notes say so.
 */
export function planConversion(
  source: { video: string | null; audio: string | null },
  wanted: Family,
  options: { mode?: string; codec?: string },
  canEncode: { video: (codec: string) => boolean; audio: (codec: string) => boolean },
): ConversionPlan {
  const notes: string[] = [];
  const attempt = (container: Family): ConversionPlan | null => {
    const fits = FITS[container];
    const pick = ENCODE[container];
    let video: TrackPlan | null = null;
    if (source.video) {
      const asked = options.codec && options.codec !== 'auto' ? options.codec : null;
      const copy =
        options.mode !== 'reencode' &&
        fits.video.includes(source.video) &&
        (!asked || asked === source.video);
      if (copy) {
        video = { copy: true };
      } else {
        const choices = asked && pick.video.includes(asked as VideoCodec) ? [asked] : pick.video;
        const codec = choices.find((c) => canEncode.video(c));
        if (!codec) return null;
        video = { copy: false, codec };
      }
    }
    let audio: TrackPlan | null = null;
    if (source.audio) {
      if (fits.audio.includes(source.audio)) {
        audio = { copy: true };
      } else {
        const codec = pick.audio.find((c) => canEncode.audio(c));
        if (!codec) return null;
        audio = { copy: false, codec };
      }
    }
    return { container, video, audio, notes };
  };
  const plan = attempt(wanted);
  if (plan) return plan;
  if (wanted !== 'webm') {
    const fallback = attempt('webm');
    if (fallback) {
      notes.push(
        `Saved as WebM: this browser can’t encode ${wanted === 'mov' ? 'H.264 or AAC for a MOV' : 'H.264 or AAC for an MP4'}. Chrome on Windows and macOS, Safari and Edge can.`,
      );
      return fallback;
    }
  }
  throw new MediaInputError(
    'This browser can’t encode video for that format. Try Chrome, Edge or Safari.',
  );
}

const FAMILIES: Family[] = ['mp4', 'webm', 'mov', 'mkv'];

/** The video packets' bytes, in order (a remux leaves them all as they were). */
export async function videoPackets(file: Blob): Promise<Uint8Array[]> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const out: Uint8Array[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) out.push(packet.data);
    return out;
  } finally {
    input.dispose();
  }
}

/** What it takes to decode one frame with WebCodecs, anywhere: the decoder config and the packets. */
export interface FrameSource {
  config: { codec: string; codedWidth: number; codedHeight: number; description?: Uint8Array };
  packets: { data: Uint8Array; timestamp: number; key: boolean }[];
}

/**
 * The packets from the key frame before `fromSec` up to `toSec`, with the
 * decoder config: enough to decode the frames in between with WebCodecs.
 * Tests read results back this way rather than through a <video> element,
 * whose formats differ between browsers (Playwright's Linux WebKit plays
 * media through GStreamer, not as Safari does).
 */
export async function videoFrameSource(
  file: Blob,
  fromSec: number,
  toSec = fromSec,
): Promise<FrameSource | null> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack();
    const config = await track?.getDecoderConfig();
    if (!track || !config) return null;
    const sink = new EncodedPacketSink(track);
    const key = (await sink.getKeyPacket(fromSec)) ?? (await sink.getFirstPacket());
    if (!key) return null;
    const packets: FrameSource['packets'] = [];
    for await (const packet of sink.packets(key)) {
      if (packet.timestamp > toSec + 1e-6 && packets.length > 0) break;
      packets.push({ data: packet.data, timestamp: packet.timestamp, key: packet.type === 'key' });
    }
    const description = config.description;
    return {
      config: {
        codec: config.codec,
        codedWidth: config.codedWidth ?? 0,
        codedHeight: config.codedHeight ?? 0,
        ...(description && {
          description: ArrayBuffer.isView(description)
            ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
            : new Uint8Array(description),
        }),
      },
      packets,
    };
  } finally {
    input.dispose();
  }
}

export const videoConverterEngine: Engine<VideoConverterOptions> = {
  ...MEDIA_META.videoConverter,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    try {
      if (!(await input.canRead())) {
        throw new MediaInputError(
          'This browser path reads MP4, MOV, WebM and MKV. AVI and older formats need our server converter, which isn’t ready yet.',
        );
      }
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      if (!video)
        throw new MediaInputError('This file has no video. For audio, use Audio Converter.');
      const videoCodec = await video.getCodec();
      const audioCodec = audio ? await audio.getCodec() : null;
      const wanted: Family = FAMILIES.includes(opts.format as Family)
        ? (opts.format as Family)
        : 'mp4';
      const size = { width: await video.getCodedWidth(), height: await video.getCodedHeight() };
      const videoOk = new Map<string, boolean>();
      const audioOk = new Map<string, boolean>();
      for (const c of new Set(Object.values(ENCODE).flatMap((e) => e.video))) {
        videoOk.set(c, await canEncodeVideo(c, size));
      }
      for (const c of new Set(Object.values(ENCODE).flatMap((e) => e.audio))) {
        audioOk.set(c, await canEncodeAudio(c));
      }
      const plan = planConversion({ video: videoCodec, audio: audioCodec }, wanted, opts, {
        video: (c) => videoOk.get(c) ?? false,
        audio: (c) => audioOk.get(c) ?? false,
      });
      if (plan.video && !plan.video.copy && !(await video.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode ${codecLabel(videoCodec)} video, so it can’t re-encode it. ${videoCodec === 'prores' ? 'ProRes needs our server converter, which isn’t ready yet.' : 'Try Chrome, Edge or Safari.'}`,
        );
      }
      if (plan.audio && !plan.audio.copy && audio && !(await audio.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the ${codecLabel(audioCodec)} audio, so it can’t convert it. Try Chrome, Edge or Safari.`,
        );
      }
      const remux = (!plan.video || plan.video.copy) && (!plan.audio || plan.audio.copy);
      const duration = await input.computeDuration();
      const out = await convert(
        {
          input,
          format: containerFormat(plan.container),
          video: (track) =>
            track === video && plan.video
              ? plan.video.copy
                ? {}
                : {
                    codec: plan.video.codec as VideoCodec,
                    forceTranscode: true,
                    quality: new Quality('high'),
                  }
              : { discard: true },
          audio: (track) =>
            track === audio && plan.audio
              ? plan.audio.copy
                ? {}
                : {
                    codec: plan.audio.codec as AudioCodec,
                    quality: new Quality('high'),
                  }
              : { discard: true },
        },
        ctx.signal,
        (f) => {
          ctx.progress(f, remux ? 'Remuxing' : 'Converting');
        },
      );
      const describe = (kind: string, codec: string | null, p: TrackPlan | null) =>
        !p
          ? []
          : p.copy
            ? [`${codecLabel(codec)} ${kind} copied, not re-encoded`]
            : [`${codecLabel(codec)} ${kind} re-encoded as ${codecLabel(p.codec)}`];
      return {
        blob: new Blob([out.bytes], { type: out.mime }),
        ext: out.ext,
        durationSec: duration,
        path: remux ? 'Browser · remux' : 'Browser · WebCodecs',
        notes: [
          remux
            ? 'Remuxed: the tracks fit the new format as they are, so nothing was re-encoded'
            : 'Re-encoded where the new format needed it',
          ...describe('video', videoCodec, plan.video),
          ...describe('audio', audioCodec, plan.audio),
          ...plan.notes,
          ...out.dropped,
        ],
        details: [{ label: 'Format', value: out.ext.toUpperCase() }],
      };
    } finally {
      input.dispose();
    }
  },
};
