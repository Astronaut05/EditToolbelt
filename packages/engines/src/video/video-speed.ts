/**
 * V13 Change Video Speed (tools/video.md): 0.25× to 4×, or any speed in
 * between. The picture is either retimed, every frame kept and copied with
 * its timestamp scaled (instant and lossless; the frame rate scales with the
 * speed), or redrawn at the original frame rate, dropping or repeating
 * frames. The sound keeps its pitch (@etb/core's TimeStretch), shifts with
 * the speed like tape (the Resampler), or is left out.
 */
import { Resampler, TimeStretch } from '@etb/core';
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  type AudioCodec,
  type InputAudioTrack,
  type VideoCodec,
} from 'mediabunny';

import { planesOf } from '../audio/stream';
import { EngineAbortError } from '../dummy';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { even, Held, shownFor } from './held';
import { codecLabel, MediaInputError, openInput } from './media';
import { containerFormat, sourceFamily } from './trim';

export interface VideoSpeedOptions {
  /** The speed: "2" plays twice as fast. 0.25 to 4, or "custom". */
  speed?: string;
  /** With speed "custom": the speed typed in. */
  customSpeed?: string;
  /** keep (the pitch), shift (with the speed, like tape) or mute. */
  audio?: string;
  /** retime (every frame kept, the rate scaled) or reencode (the original frame rate). */
  frames?: string;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

export function speedOf(value: string | undefined): number {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
    throw new MediaInputError(`Set a speed from ${String(MIN_SPEED)}× to ${String(MAX_SPEED)}×.`);
  }
  if (speed === 1) throw new MediaInputError('Set a speed other than 1×.');
  return speed;
}

export async function audioCodecFor(mime: string, channels: number): Promise<AudioCodec | null> {
  const candidates: AudioCodec[] =
    mime === 'video/webm' ? ['opus'] : mime === 'video/x-matroska' ? ['opus', 'aac'] : ['aac'];
  for (const codec of candidates) {
    if (await canEncodeAudio(codec, { sampleRate: 48_000, numberOfChannels: channels }))
      return codec;
  }
  return null;
}

/** The sound at the new speed, block by block: stretched (pitch kept) or resampled (pitch moved). */
async function writeAudio(
  track: InputAudioTrack,
  source: AudioSampleSource,
  speed: number,
  keepPitch: boolean,
  signal: AbortSignal,
): Promise<void> {
  const rate = await track.getSampleRate();
  const channels = Math.min(2, await track.getNumberOfChannels());
  const stretcher = keepPitch ? new TimeStretch(channels, 1 / speed) : null;
  const resampler = keepPitch ? null : new Resampler(rate * speed, rate, channels);
  let written = 0;
  const write = async (planes: Float32Array[]) => {
    const n = planes[0]?.length ?? 0;
    if (n === 0) return;
    const data = new Float32Array(n * channels);
    planes.forEach((plane, c) => {
      data.set(plane, c * n);
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
  };
  for await (const decoded of new AudioSampleSink(track).samples()) {
    if (signal.aborted) {
      decoded.close();
      throw new EngineAbortError();
    }
    const planes = planesOf(decoded, channels);
    decoded.close();
    await write(stretcher ? stretcher.push(planes) : (resampler?.push(planes) ?? planes));
  }
  await write(stretcher ? stretcher.flush() : (resampler?.flush() ?? []));
  source.close();
}

const fixed = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

export const videoSpeedEngine: Engine<VideoSpeedOptions> = {
  ...MEDIA_META.videoSpeed,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const speed = speedOf(opts.speed === 'custom' ? opts.customSpeed : opts.speed);
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video in it.');
      const audio = opts.audio === 'mute' ? null : await input.getPrimaryAudioTrack();
      if (audio && !(await audio.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode the ${codecLabel(await audio.getCodec())} sound, so it can’t change its speed. Choose Mute, or try Chrome, Edge or Safari.`,
        );
      }
      const format = containerFormat(await sourceFamily(input));
      const reencode = opts.frames === 'reencode';
      const metrics = await video.computeFrameRateMetrics().catch(() => null);
      const fps = metrics?.bestGuessFrameRate ?? 30;
      const duration = await shownFor(video, fps);
      const length = duration / speed;
      const shown = {
        width: await video.getDisplayWidth(),
        height: await video.getDisplayHeight(),
      };
      // Redrawn frames are encoded, and H.264 and HEVC take only even sizes (a 1437 × 899 screen recording).
      const width = reencode ? even(shown.width) : shown.width;
      const height = reencode ? even(shown.height) : shown.height;
      const resized = width !== shown.width || height !== shown.height;

      let videoCodec: VideoCodec | null = null;
      if (reencode) {
        if (!(await video.canDecode())) {
          throw new MediaInputError(
            `This browser can’t decode ${codecLabel(await video.getCodec())} video, so it can’t redraw the frames. Keep every frame instead.`,
          );
        }
        const candidates: VideoCodec[] =
          format.mimeType === 'video/webm'
            ? ['vp9', 'av1', 'vp8']
            : format.mimeType === 'video/x-matroska'
              ? ['vp9', 'avc']
              : ['avc', 'hevc', 'av1'];
        for (const codec of candidates) {
          if (await canEncodeVideo(codec, { width, height })) {
            videoCodec = codec;
            break;
          }
        }
        if (!videoCodec)
          throw new MediaInputError(
            'This browser can’t encode video for this format. Keep every frame instead.',
          );
      }
      const channels = audio ? Math.min(2, await audio.getNumberOfChannels()) : 2;
      const audioCodec = audio ? await audioCodecFor(format.mimeType, channels) : null;

      const target = new BufferTarget();
      const output = new Output({ format, target });
      output.setMetadataTags(await input.getMetadataTags());
      const metadata = format.supportsVideoTransformationMetadata
        ? { transformationMatrix: await video.getTransformationMatrix() }
        : {};
      const packetSource = reencode
        ? null
        : new EncodedVideoPacketSource((await video.getCodec()) as VideoCodec);
      const sampleSource =
        reencode && videoCodec
          ? new VideoSampleSource({ codec: videoCodec, quality: new Quality('high') })
          : null;
      // Mediabunny puts every timestamp on a track's frame rate, so a clip
      // without a steady one (a phone's variable frame rate) gets none and
      // keeps its own frame times, each scaled by the speed.
      const steady = metrics?.underlyingFrameRate ? { frameRate: fps * speed } : {};
      if (packetSource) output.addVideoTrack(packetSource, { ...metadata, ...steady });
      if (sampleSource) output.addVideoTrack(sampleSource, { frameRate: fps });
      const audioSource = audioCodec
        ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: 160_000 }) })
        : null;
      if (audioSource) output.addAudioTrack(audioSource);
      await output.start();

      const writeVideo = async () => {
        if (packetSource) {
          const config = await video.getDecoderConfig();
          let first = true;
          for await (const packet of new EncodedPacketSink(video).packets()) {
            if (ctx.signal.aborted) throw new EngineAbortError();
            await packetSource.add(
              packet.clone({
                timestamp: packet.timestamp / speed,
                duration: packet.duration / speed,
              }),
              first && config ? { decoderConfig: config } : undefined,
            );
            first = false;
            ctx.progress(Math.min(1, packet.timestamp / duration), 'Retiming');
          }
          packetSource.close();
          return;
        }
        if (!sampleSource) return;
        // Each output frame shows the source frame on screen at its time × speed.
        const held = new Held(video);
        const canvas = new OffscreenCanvas(width, height);
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) throw new Error('No 2D canvas in this browser');
        const total = Math.max(1, Math.round(length * fps));
        try {
          for (let n = 0; n < total; n += 1) {
            if (ctx.signal.aborted) throw new EngineAbortError();
            const frame = await held.at((n / fps) * speed);
            if (frame) frame.drawWithFit(ctx2d, { fit: 'fill' });
            const sample = new VideoSample(canvas, { timestamp: n / fps, duration: 1 / fps });
            await sampleSource.add(sample);
            sample.close();
            ctx.progress((n + 1) / total, 'Redrawing');
          }
        } finally {
          held.close();
        }
        sampleSource.close();
      };
      try {
        await Promise.all([
          writeVideo(),
          audio && audioSource
            ? writeAudio(audio, audioSource, speed, opts.audio !== 'shift', ctx.signal)
            : Promise.resolve(),
        ]);
        await output.finalize();
      } catch (error) {
        await output.cancel().catch(() => undefined);
        if (ctx.signal.aborted) throw new EngineAbortError();
        throw error;
      }
      const bytes = target.buffer;
      if (!bytes) throw new Error('No file was written');
      const notes = [
        `${fixed(speed)}×: ${duration.toFixed(2)} s → ${length.toFixed(2)} s`,
        reencode
          ? `Redrawn at ${fixed(fps)} fps, ${speed > 1 ? 'dropping' : 'repeating'} frames, ${codecLabel(videoCodec)}${resized ? `, at ${String(width)} × ${String(height)} px: encoders take even sizes` : ''}`
          : `Every frame kept and copied, now at ${fixed(fps * speed)} fps: instant and lossless`,
        !audio
          ? opts.audio === 'mute'
            ? 'Sound left out'
            : 'This video has no sound'
          : !audioCodec
            ? 'This browser can’t encode sound for this format, so the result is silent'
            : opts.audio === 'shift'
              ? `Sound sped ${speed > 1 ? 'up' : 'down'} with its pitch, like tape`
              : 'Sound at the new speed with its pitch kept',
      ];
      return {
        blob: new Blob([bytes], { type: format.mimeType }),
        ext: format.fileExtension.slice(1),
        durationSec: length,
        ...(reencode && { width, height }),
        path: reencode ? 'Browser · WebCodecs' : 'Browser · stream copy',
        notes,
        details: [
          { label: 'Speed', value: `${fixed(speed)}×` },
          { label: 'Length', value: `${length.toFixed(2)} s` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
