/**
 * V19 Loop Video (tools/video.md): the clip repeated a number of times or up
 * to a length, or played forwards then backwards as a boomerang.
 *
 * Repeats are copied packet for packet, each copy's timestamps moved along
 * by the clip's length: instant and lossless, the "fast concat". A length
 * that ends partway through a copy cuts its last frames off, which is safe
 * only when no frame depends on a later one; a clip with reordered frames
 * (B-frames) is encoded again instead. So is a boomerang, whose backward
 * half is read a stretch at a time (./clip-frames.ts) and whose sound is
 * reversed with it.
 */
import { reversePieces, type ReversePiece } from '@etb/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  Quality,
  VideoSampleSource,
  type AudioCodec,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

import { reversedFrames } from '../audio/reverse';
import { EngineAbortError } from '../dummy';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { ClipFrames } from './clip-frames';
import { shownFor } from './held';
import { VIDEO_LIMITS } from './limits';
import { codecLabel, MediaInputError, openInput } from './media';
import { encoderFor } from './reverse-video';
import { containerFormat, sourceFamily } from './trim';
import { audioCodecFor } from './video-speed';

export interface LoopVideoOptions {
  /** times (a number of copies) or length (up to a duration). */
  mode?: string;
  /** With mode times: 2 to 50. */
  times?: string;
  /** With mode length: seconds. */
  length?: string;
  /** on: forwards, then backwards, as one loop. */
  boomerang?: string;
  /** keep or mute. */
  audio?: string;
}

export const MAX_TIMES = 50;
/** Two timestamps closer than this are the same, seconds. */
const EPSILON = 1e-6;
/** Seconds of sound turned round at a time, in a boomerang. */
const AUDIO_WINDOW = 10;

/** How many copies and how long, from the options and the clip's (or a boomerang's) loop length. */
export function loopPlan(
  opts: LoopVideoOptions,
  loop: number,
): { loops: number; total: number; label: string } {
  if (opts.mode === 'length') {
    const length = Number(opts.length);
    if (!Number.isFinite(length) || length <= 0)
      throw new MediaInputError('Set a length in seconds.');
    if (length > VIDEO_LIMITS.maxSeconds) {
      throw new MediaInputError('Set a length of 60 min or less, the browser limit for video.');
    }
    if (length < loop - EPSILON) {
      throw new MediaInputError(
        `The clip is already ${loop.toFixed(2)} s long. Set a longer length, or trim it instead.`,
      );
    }
    return {
      loops: Math.ceil(length / loop - EPSILON),
      total: length,
      label: `${String(length)} s`,
    };
  }
  const times = Math.round(Number(opts.times));
  if (!Number.isFinite(times) || times < 2 || times > MAX_TIMES) {
    throw new MediaInputError(`Repeat it 2 to ${String(MAX_TIMES)} times.`);
  }
  if (times * loop > VIDEO_LIMITS.maxSeconds) {
    throw new MediaInputError(
      `That makes ${((times * loop) / 60).toFixed(0)} min, over the browser limit of 60. Repeat it fewer times.`,
    );
  }
  return { loops: times, total: times * loop, label: `${String(times)}×` };
}

/** Whether any frame is shown before one decoded ahead of it: B-frames. */
async function reordered(video: InputVideoTrack, signal: AbortSignal): Promise<boolean> {
  let latest = -Infinity;
  for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
    metadataOnly: true,
  })) {
    if (signal.aborted) throw new EngineAbortError();
    if (packet.timestamp < latest - EPSILON) return true;
    latest = Math.max(latest, packet.timestamp);
  }
  return false;
}

/** The sound, re-encoded: forwards each loop, or forwards then backwards, cut at `total`. */
async function writeAudio(
  audio: InputAudioTrack,
  source: AudioSampleSource,
  loopPieces: ReversePiece[],
  loops: number,
  total: number,
  channels: number,
  signal: AbortSignal,
): Promise<void> {
  const rate = await audio.getSampleRate();
  const until = Math.round(total * rate);
  const pieces = Array.from({ length: loops }, () => loopPieces).flat();
  let written = 0;
  for await (const planes of reversedFrames(audio, pieces, channels, signal)) {
    const n = Math.min(planes[0]?.length ?? 0, until - written);
    if (n <= 0) break;
    const data = new Float32Array(n * channels);
    planes.forEach((plane, c) => {
      data.set(plane.subarray(0, n), c * n);
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
    written += n;
  }
  source.close();
}

export const loopVideoEngine: Engine<LoopVideoOptions> = {
  ...MEDIA_META.loopVideo,
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > VIDEO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 2 GB, the browser limit for video.');
    }
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video in it.');
      const audio = opts.audio === 'mute' ? null : await input.getPrimaryAudioTrack();
      const format = containerFormat(await sourceFamily(input));
      const metrics = await video.computeFrameRateMetrics().catch(() => null);
      const fps = metrics?.bestGuessFrameRate ?? 30;
      const boomerang = opts.boomerang === 'on';
      const end = await shownFor(video, fps);
      const first = await video.getFirstTimestamp();
      const clip = boomerang ? await ClipFrames.read(video, fps, ctx.signal) : null;
      // A boomerang's loop: every frame forwards, then back without repeating the frames it turns on.
      const loopLength = clip
        ? clip.count < 3
          ? end - first
          : 2 * (end - first) - clip.duration(0) - clip.duration(clip.count - 1)
        : end - first;
      if (loopLength <= 0) throw new MediaInputError('This video has no frames in it.');
      const plan = loopPlan(opts, loopLength);
      const cutsMidway = plan.total < plan.loops * loopLength - EPSILON;
      const copy = !boomerang && !(cutsMidway && (await reordered(video, ctx.signal)));
      if (copy && file.size * plan.loops > VIDEO_LIMITS.maxBytes) {
        throw new MediaInputError(
          `That makes about ${((file.size * plan.loops) / 1024 ** 3).toFixed(1)} GB, over the browser limit of 2 GB. Repeat it fewer times.`,
        );
      }
      if (!copy && !(await video.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode ${codecLabel(await video.getCodec())} video, so it can’t ${boomerang ? 'make a boomerang' : 'cut the last copy'}. Try Chrome, Edge or Safari.`,
        );
      }

      const target = new BufferTarget();
      const output = new Output({ format, target });
      output.setMetadataTags(await input.getMetadataTags());

      // The picture: copied packets, or frames encoded again.
      const sourceCodec = await video.getCodec();
      if (copy && !sourceCodec)
        throw new MediaInputError('This video’s codec isn’t one this tool can copy.');
      const packetSource = copy && sourceCodec ? new EncodedVideoPacketSource(sourceCodec) : null;
      const videoCodec = copy
        ? null
        : await encoderFor(
            format.mimeType,
            await video.getDisplayWidth(),
            await video.getDisplayHeight(),
          );
      const sampleSource = videoCodec
        ? new VideoSampleSource({ codec: videoCodec, quality: new Quality('high') })
        : null;
      if (packetSource) {
        output.addVideoTrack(packetSource, {
          ...(format.supportsVideoTransformationMetadata && {
            transformationMatrix: await video.getTransformationMatrix(),
          }),
          frameRate: fps,
        });
      }
      if (sampleSource) output.addVideoTrack(sampleSource, { frameRate: fps });

      // The sound: copied with the picture, or decoded and encoded again.
      const audioCodecIn = audio ? await audio.getCodec() : null;
      const copyAudio = copy && audio && audioCodecIn ? audioCodecIn : null;
      const reencodeAudio = !copy && audio && (await audio.canDecode()) ? audio : null;
      const channels = reencodeAudio ? Math.min(2, await reencodeAudio.getNumberOfChannels()) : 2;
      const audioCodecOut: AudioCodec | null = reencodeAudio
        ? await audioCodecFor(format.mimeType, channels)
        : null;
      const audioPackets = copyAudio ? new EncodedAudioPacketSource(copyAudio) : null;
      const audioSamples =
        reencodeAudio && audioCodecOut
          ? new AudioSampleSource({
              codec: audioCodecOut,
              quality: new Quality({ bitrate: 160_000 }),
            })
          : null;
      if (audioPackets) output.addAudioTrack(audioPackets);
      if (audioSamples) output.addAudioTrack(audioSamples);
      await output.start();

      const copyVideo = async () => {
        if (!packetSource) return;
        const config = await video.getDecoderConfig();
        let firstPacket = true;
        for (let loop = 0; loop < plan.loops; loop += 1) {
          const offset = loop * loopLength;
          const limit = first + Math.min(loopLength, plan.total - offset);
          for await (const packet of new EncodedPacketSink(video).packets()) {
            if (ctx.signal.aborted) throw new EngineAbortError();
            // Past the length: only the last copy has any, and none is needed by a frame kept.
            if (packet.timestamp >= limit - EPSILON) continue;
            await packetSource.add(
              packet.clone({
                timestamp: packet.timestamp + offset,
                duration: Math.min(packet.duration, limit - packet.timestamp),
              }),
              firstPacket && config ? { decoderConfig: config } : undefined,
            );
            firstPacket = false;
          }
          ctx.progress(Math.min(1, (loop + 1) / plan.loops), 'Copying');
        }
        packetSource.close();
      };

      const copySound = async () => {
        if (!audio || !audioPackets) return;
        const config = await audio.getDecoderConfig();
        let firstPacket = true;
        for (let loop = 0; loop < plan.loops; loop += 1) {
          const offset = loop * loopLength;
          const limit = first + Math.min(loopLength, plan.total - offset);
          for await (const packet of new EncodedPacketSink(audio).packets()) {
            if (ctx.signal.aborted) throw new EngineAbortError();
            // A copy's sound stops where its picture does; the encoder's lead-in plays only once.
            if (packet.timestamp >= limit - EPSILON) break;
            if (loop > 0 && packet.timestamp < first) continue;
            await audioPackets.add(
              packet.clone({ timestamp: packet.timestamp + offset }),
              firstPacket && config ? { decoderConfig: config } : undefined,
            );
            firstPacket = false;
          }
        }
        audioPackets.close();
      };

      const redrawVideo = async () => {
        if (!sampleSource) return;
        const frames = clip ?? (await ClipFrames.read(video, fps, ctx.signal));
        let at = 0;
        let done = 0;
        const expected = Math.max(1, Math.round(plan.total * fps));
        outer: for (let loop = 0; loop < plan.loops; loop += 1) {
          const runs = boomerang
            ? [
                frames.forward(0, frames.count, ctx.signal),
                frames.backward(1, frames.count - 1, ctx.signal),
              ]
            : [frames.forward(0, frames.count, ctx.signal)];
          for (const run of runs) {
            for await (const { copy: sample, index } of run) {
              if (at >= plan.total - EPSILON) {
                sample.close();
                await run.return(undefined);
                break outer;
              }
              const duration = Math.min(frames.duration(index), plan.total - at);
              sample.setTimestamp(at);
              sample.setDuration(duration);
              try {
                await sampleSource.add(sample);
              } finally {
                sample.close();
              }
              at += duration;
              done += 1;
              ctx.progress(
                Math.min(1, done / expected),
                boomerang ? 'Making the boomerang' : 'Looping',
              );
            }
          }
        }
        sampleSource.close();
      };

      const reencodeSound = async () => {
        if (!reencodeAudio || !audioSamples) return;
        const rate = await reencodeAudio.getSampleRate();
        const from = Math.round(first * rate);
        const to = Math.round(end * rate);
        const loopPieces: ReversePiece[] = [{ from, to, reverse: false }];
        if (boomerang && clip && clip.count >= 3) {
          // Backwards over the frames between the turns, as the picture does.
          const a = Math.round((first + clip.duration(0)) * rate);
          const b = Math.round((end - clip.duration(clip.count - 1)) * rate);
          loopPieces.push(
            ...reversePieces(a, b, AUDIO_WINDOW * rate, b).filter((piece) => piece.reverse),
          );
        }
        await writeAudio(
          reencodeAudio,
          audioSamples,
          loopPieces,
          plan.loops,
          plan.total,
          channels,
          ctx.signal,
        );
      };

      try {
        await Promise.all(copy ? [copyVideo(), copySound()] : [redrawVideo(), reencodeSound()]);
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        if (ctx.signal.aborted) throw new EngineAbortError();
        throw error;
      }
      const bytes = target.buffer;
      if (!bytes) throw new Error('No file was written');
      const sound = !audio
        ? opts.audio === 'mute'
          ? 'Sound left out'
          : 'This video has no sound'
        : copy
          ? 'Sound copied with each loop'
          : !reencodeAudio
            ? `This browser can’t decode the ${codecLabel(audioCodecIn)} sound, so the result is silent`
            : !audioCodecOut
              ? 'This browser can’t encode sound for this format, so the result is silent'
              : boomerang
                ? 'Sound forwards, then backwards, with the picture'
                : 'Sound looped with the picture';
      const loops = plan.loops === 1 ? '1 loop' : `${String(plan.loops)} loops`;
      return {
        blob: new Blob([bytes], { type: format.mimeType }),
        ext: format.fileExtension.slice(1),
        durationSec: plan.total,
        path: copy ? 'Browser · stream copy' : 'Browser · WebCodecs',
        notes: [
          `${boomerang ? 'Boomerang, ' : ''}${loops} of ${loopLength.toFixed(2)} s: ${plan.total.toFixed(2)} s`,
          copy
            ? cutsMidway
              ? 'Copied without re-encoding, the last loop cut at the length: instant and lossless'
              : 'Copied without re-encoding: instant and lossless'
            : boomerang
              ? `Encoded again as ${codecLabel(videoCodec)}: a boomerang plays frames backwards`
              : `Encoded again as ${codecLabel(videoCodec)}: this clip's frames depend on later ones, so the last loop can't be cut by copying`,
          sound,
        ],
        details: [
          { label: 'Loops', value: plan.label },
          { label: 'Length', value: `${plan.total.toFixed(2)} s` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
