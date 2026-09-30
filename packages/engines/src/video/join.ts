/**
 * V01 Trim Video's join: several kept parts of one video, end to end, in one
 * file (tools/video.md → V01).
 *
 * - `copy` (Fast): each part's packets are copied from the keyframe at or
 *   before its In point, so a part can start up to one keyframe interval early.
 * - `smart` (Precise, VP8 and VP9 in WebM or Matroska): only the frames from
 *   each In point to the next keyframe are re-encoded, in the same codec, and
 *   the rest is copied. Every cut lands on the frame; most of the picture is
 *   untouched.
 * - `encode` (Precise, anything else): every kept frame is re-encoded. H.264
 *   and HEVC keep their parameter sets once, in the MP4 header, so frames from
 *   another encoder can't join a copied track.
 *
 * The audio is joined by the splicer (a 10 ms crossfade at each join) and
 * re-encoded where the browser can; otherwise each part's packets are copied,
 * and a join may click.
 */
import type { Span } from '@etb/core';
import {
  AudioSampleSource,
  BufferTarget,
  canEncodeAudio,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  NullTarget,
  Output,
  Quality,
  VideoSampleSink,
  VideoSampleSource,
  WebMOutputFormat,
  type AudioCodec,
  type EncodedPacket,
  type Input,
  type InputAudioTrack,
  type InputVideoTrack,
  type OutputFormat,
  type VideoCodec,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { codecLabel, MediaInputError, type RunOutput } from './media';
import { spliceAudio } from './splice-audio';

export type JoinMode = 'copy' | 'smart' | 'encode';

/** The crossfade at each join, seconds. */
export const VIDEO_JOIN_CROSSFADE = 0.01;

/** Float slack on timestamps, seconds: well under a frame. */
const EPS = 1e-4;

/** Packets decoded after a part's end that can still be needed for it: deeper than any B-frame pyramid. */
const REORDER = 16;

/** One kept part: the source it plays and where that lands in the result. */
export interface JoinPart {
  /** Source seconds actually written: from the keyframe in `copy` mode, else on the frame. */
  start: number;
  end: number;
  /** Where the part starts in the result, seconds. */
  offset: number;
  /** Seconds of it re-encoded (`smart` and `encode`). */
  reencoded: number;
}

export interface JoinResult extends RunOutput {
  parts: JoinPart[];
  length: number;
  /** How the audio went in: crossfaded and re-encoded, copied part by part, or left out. */
  audio: 'spliced' | 'copied' | 'none';
  notes: string[];
}

export interface JoinOptions {
  input: Input;
  video: InputVideoTrack;
  audio: InputAudioTrack | null;
  /** The kept spans, source seconds, in order and apart. */
  spans: readonly Span[];
  mode: JoinMode;
  format: OutputFormat;
  /** `encode`: the codecs to write. */
  videoCodec?: VideoCodec;
  audioCodec?: AudioCodec;
}

/**
 * A part's packets to copy, in decode order from `key`: every packet shown
 * before `end`, and any decoded before one of those (the frames B-frames refer
 * to). Leading frames shown before the keyframe (an open GOP) are left out:
 * they can't be decoded without the GOP before.
 */
async function* partPackets(
  sink: EncodedPacketSink,
  key: EncodedPacket,
  end: number,
  metadataOnly: boolean,
): AsyncGenerator<EncodedPacket> {
  const pending: EncodedPacket[] = [];
  for await (const packet of sink.packets(key, undefined, { metadataOnly })) {
    if (packet.timestamp < key.timestamp - EPS) continue;
    if (packet.timestamp < end - EPS) {
      yield* pending;
      pending.length = 0;
      yield packet;
    } else {
      pending.push(packet);
      if (pending.length >= REORDER) return;
    }
  }
}

interface PlannedPart extends JoinPart {
  /** The first packet to copy, a keyframe; null when the whole part is re-encoded. */
  copyFrom: EncodedPacket | null;
  /** Frames shown before this source time are the part's (copied or re-encoded). */
  stop: number;
}

/** Where each part starts and ends in the source, and where it lands. */
async function planParts(
  sink: EncodedPacketSink,
  spans: readonly Span[],
  mode: JoinMode,
): Promise<PlannedPart[]> {
  const parts: PlannedPart[] = [];
  let offset = 0;
  for (const span of spans) {
    if (mode === 'copy') {
      const key =
        (await sink.getKeyPacket(span.start + EPS, { verifyKeyPackets: true })) ??
        (await sink.getFirstKeyPacket({ verifyKeyPackets: true }));
      if (!key) throw new MediaInputError('This video has no keyframe to cut at.');
      let end = key.timestamp;
      for await (const packet of partPackets(sink, key, span.end, true)) {
        end = Math.max(end, packet.timestamp + packet.duration);
      }
      const start = Math.max(0, key.timestamp);
      parts.push({ start, end, offset, reencoded: 0, copyFrom: key, stop: span.end });
      offset += end - start;
      continue;
    }
    // On the frame: from the frame on screen at In to the end of the one on screen just before Out.
    const first = await sink.getPacket(span.start + EPS, { metadataOnly: true });
    const last = await sink.getPacket(span.end - EPS, { metadataOnly: true });
    const start = Math.max(0, first?.timestamp ?? span.start);
    const end = last && last.duration > 0 ? last.timestamp + last.duration : span.end;
    // Cut after the last kept frame itself: containers round durations (WebM to
    // the millisecond), so its end can land just past the next frame's start.
    const stop = last ? last.timestamp + 2 * EPS : span.end;
    let copyFrom: EncodedPacket | null = null;
    if (mode === 'smart') {
      const key = await sink.getKeyPacket(start + EPS, { verifyKeyPackets: true });
      copyFrom =
        key && key.timestamp >= start - EPS
          ? key
          : key
            ? await sink.getNextKeyPacket(key, { verifyKeyPackets: true })
            : await sink.getFirstKeyPacket({ verifyKeyPackets: true });
      // A keyframe at or past the end: the whole part is re-encoded.
      if (copyFrom && copyFrom.timestamp >= stop - EPS) copyFrom = null;
    }
    const reencoded = mode === 'encode' ? end - start : (copyFrom?.timestamp ?? end) - start;
    parts.push({ start, end, offset, reencoded: Math.max(0, reencoded), copyFrom, stop });
    offset += end - start;
  }
  return parts;
}

/**
 * Re-encodes the frames of [from, to) on their own encoder, so the packets
 * start with a keyframe, and returns them moved by `shift` with the encoder's
 * metadata. The frames go through a throwaway output that keeps nothing.
 */
async function encodeRun(
  track: InputVideoTrack,
  from: number,
  to: number,
  codec: VideoCodec,
  bitrate: number,
  shift: number,
  signal: AbortSignal,
): Promise<{ packets: EncodedPacket[]; decoderConfig: VideoDecoderConfig | null }> {
  const packets: EncodedPacket[] = [];
  let decoderConfig: VideoDecoderConfig | null = null;
  const output = new Output({ format: new WebMOutputFormat(), target: new NullTarget() });
  const source = new VideoSampleSource({
    codec,
    quality: new Quality({ bitrate }),
    onEncodedPacket: (packet, meta) => {
      packets.push(packet.clone({ timestamp: packet.timestamp + shift }));
      decoderConfig ??= meta?.decoderConfig ?? null;
    },
  });
  output.addVideoTrack(source);
  await output.start();
  try {
    for await (const sample of new VideoSampleSink(track).samples(from, to)) {
      try {
        if (signal.aborted) throw new EngineAbortError();
        if (sample.timestamp < from - EPS || sample.timestamp >= to - EPS) continue;
        sample.setTimestamp(sample.timestamp - from);
        await source.add(sample);
      } finally {
        sample.close();
      }
    }
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
  return { packets, decoderConfig };
}

/**
 * Whether the audio can be crossfaded here, copied, or not joined at all, and
 * in which codec: the one asked for, else the source's own, else AAC in MP4
 * and MOV or Opus in WebM and Matroska (Opus never goes into an MP4).
 */
async function planAudio(
  track: InputAudioTrack | null,
  format: OutputFormat,
  wanted: AudioCodec | undefined,
): Promise<{ kind: 'spliced' | 'copied' | 'none'; codec: AudioCodec | null }> {
  if (!track) return { kind: 'none', codec: null };
  const source = await track.getCodec();
  const writable = format.getSupportedAudioCodecs();
  const isobmff = format.mimeType === 'video/mp4' || format.mimeType === 'video/quicktime';
  const fallback: AudioCodec = isobmff ? 'aac' : 'opus';
  const candidates = [wanted, source, fallback].filter(
    (c): c is AudioCodec => !!c && writable.includes(c) && !(isobmff && c === 'opus'),
  );
  if (candidates.length > 0 && (await track.canDecode())) {
    for (const codec of candidates) {
      if (await canEncodeAudio(codec)) return { kind: 'spliced', codec };
    }
  }
  if (source && writable.includes(source)) return { kind: 'copied', codec: source };
  return { kind: 'none', codec: null };
}

/** Joins the kept parts of `video` (and its audio) into one file. */
export async function joinParts(
  options: JoinOptions,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<JoinResult> {
  const { input, video, audio, spans, mode, format } = options;
  const sink = new EncodedPacketSink(video);
  const parts = await planParts(sink, spans, mode);
  const length = parts.reduce((sum, p) => sum + (p.end - p.start), 0);
  const audioPlan = await planAudio(audio, format, options.audioCodec);
  const sourceCodec = await video.getCodec();
  if (!sourceCodec) throw new MediaInputError('This video’s codec isn’t one the browser knows.');
  const videoCodec: VideoCodec = mode === 'encode' ? (options.videoCodec ?? 'avc') : sourceCodec;
  const sourceConfig = await video.getDecoderConfig();
  const metadata = format.supportsVideoTransformationMetadata;
  const rotation = await video.getRotation();
  const flip = await video.getFlip();

  const target = new BufferTarget();
  const output = new Output({ format, target });
  output.setMetadataTags(await input.getMetadataTags());

  const packetSource = mode === 'encode' ? null : new EncodedVideoPacketSource(videoCodec);
  // A re-encode bakes a rotation in when the container can't say it.
  const bake = !metadata && (rotation !== 0 || flip);
  const sampleSource =
    mode === 'encode'
      ? new VideoSampleSource({
          codec: videoCodec,
          quality: new Quality('high'),
          ...(bake && {
            transform: {
              width:
                rotation % 180 === 0
                  ? await video.getSquarePixelWidth()
                  : await video.getSquarePixelHeight(),
              height:
                rotation % 180 === 0
                  ? await video.getSquarePixelHeight()
                  : await video.getSquarePixelWidth(),
              fit: 'fill' as const,
            },
          }),
        })
      : null;
  const trackSource = packetSource ?? sampleSource;
  if (!trackSource) throw new Error('No video source');
  output.addVideoTrack(trackSource, {
    ...(metadata && { transformationMatrix: await video.getTransformationMatrix() }),
  });
  const audioSource =
    audioPlan.kind === 'spliced' && audioPlan.codec
      ? new AudioSampleSource({
          codec: audioPlan.codec,
          quality: new Quality({
            bitrate: Math.max(
              96_000,
              (await audio?.getAverageBitrate().catch(() => null)) ?? 128_000,
            ),
          }),
        })
      : audioPlan.kind === 'copied' && audioPlan.codec
        ? new EncodedAudioPacketSource(audioPlan.codec)
        : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  const writeVideo = async () => {
    let first = true;
    const add = async (packet: EncodedPacket, config: VideoDecoderConfig | null) => {
      if (!packetSource) return;
      await packetSource.add(packet, first && config ? { decoderConfig: config } : undefined);
      first = false;
    };
    const bitrate =
      mode === 'smart'
        ? Math.max(200_000, 1.5 * ((await video.computePacketStats(120)).averageBitrate || 0))
        : 0;
    for (const part of parts) {
      const shift = part.offset - part.start;
      if (sampleSource) {
        for await (const sample of new VideoSampleSink(video).samples(part.start, part.stop)) {
          try {
            if (signal.aborted) throw new EngineAbortError();
            if (sample.timestamp < part.start - EPS || sample.timestamp >= part.stop - EPS)
              continue;
            sample.setTimestamp(sample.timestamp + shift);
            await sampleSource.add(sample);
            progress(Math.min(1, (sample.timestamp + sample.duration) / length));
          } finally {
            sample.close();
          }
        }
        continue;
      }
      if (mode === 'smart' && part.reencoded > EPS) {
        const run = await encodeRun(
          video,
          part.start,
          part.copyFrom?.timestamp ?? part.stop,
          videoCodec,
          bitrate,
          part.offset,
          signal,
        );
        // The source's own config heads the track even when re-encoded frames come
        // first: the muxer rewrites every VP9 keyframe's colour space to match it,
        // and the copied ones must stay as they are.
        for (const packet of run.packets) await add(packet, sourceConfig ?? run.decoderConfig);
      }
      if (part.copyFrom) {
        for await (const packet of partPackets(sink, part.copyFrom, part.stop, false)) {
          if (signal.aborted) throw new EngineAbortError();
          await add(packet.clone({ timestamp: packet.timestamp + shift }), sourceConfig);
          progress(Math.min(1, (packet.timestamp + shift) / length));
        }
      }
    }
    trackSource.close();
  };

  const writeAudio = async () => {
    if (!audio || !audioSource) return;
    if (audioSource instanceof AudioSampleSource) {
      await spliceAudio(
        audio,
        {
          spans: parts.map((p) => ({ start: p.start, end: p.end })),
          crossfade: VIDEO_JOIN_CROSSFADE,
        },
        (sample) => audioSource.add(sample),
        signal,
        () => undefined,
      );
    } else {
      const config = await audio.getDecoderConfig();
      const audioSink = new EncodedPacketSink(audio);
      let first = true;
      let next = 0;
      for (const part of parts) {
        const from = (await audioSink.getPacket(part.start)) ?? (await audioSink.getFirstPacket());
        if (!from) break;
        for await (const packet of audioSink.packets(from)) {
          if (signal.aborted) throw new EngineAbortError();
          const middle = packet.timestamp + packet.duration / 2;
          if (middle < part.start) continue;
          if (middle >= part.end) break;
          // Back to back, never earlier than the packet before.
          const timestamp = Math.max(next, packet.timestamp - part.start + part.offset);
          await audioSource.add(
            packet.clone({ timestamp }),
            first && config ? { decoderConfig: config } : undefined,
          );
          first = false;
          next = timestamp + packet.duration;
        }
      }
    }
    audioSource.close();
  };

  try {
    await Promise.all([writeVideo(), writeAudio()]);
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    if (signal.aborted) throw new EngineAbortError();
    throw error;
  }
  if (signal.aborted) throw new EngineAbortError();
  const bytes = target.buffer;
  if (!bytes) throw new Error('The joiner produced no file');

  const audioCodec = audioPlan.codec ?? (await audio?.getCodec()) ?? null;
  const notes: string[] = [];
  if (audio && audioPlan.kind === 'copied' && parts.length > 1) {
    notes.push(
      `The audio is copied part by part, so a join may click: this browser can’t re-encode ${codecLabel(audioCodec)} to crossfade it`,
    );
  }
  if (audio && audioPlan.kind === 'none') {
    notes.push('The audio couldn’t be joined in this browser, so it was left out');
  }
  return {
    bytes,
    mime: format.mimeType,
    ext: format.fileExtension.slice(1),
    parts: parts.map(({ start, end, offset, reencoded }) => ({ start, end, offset, reencoded })),
    length,
    audio: audioPlan.kind,
    notes,
  };
}
