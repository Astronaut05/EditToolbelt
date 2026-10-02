/**
 * V18 Reverse Video (tools/video.md): the clip played backwards, with its
 * sound reversed or left out. The picture is read from its end a stretch at
 * a time (./clip-frames.ts), so memory doesn't grow with the clip's length,
 * and each frame keeps its own duration, so a variable frame rate stays as
 * it was, backwards. The sound is turned round ten seconds at a time (A15's
 * reader), lined up with the picture's end.
 */
import { reversePieces } from '@etb/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  canEncodeVideo,
  Output,
  Quality,
  VideoSampleSource,
  type VideoCodec,
} from 'mediabunny';

import { reversedFrames } from '../audio/reverse';
import { EngineAbortError } from '../dummy';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { ClipFrames } from './clip-frames';
import { VIDEO_LIMITS } from './limits';
import { codecLabel, MediaInputError, openInput } from './media';
import { containerFormat, sourceFamily } from './trim';
import { audioCodecFor } from './video-speed';

export interface ReverseVideoOptions {
  /** reverse (the sound plays backwards too) or mute (left out). */
  audio?: string;
}

/** Seconds of sound turned round at a time. */
const AUDIO_WINDOW = 10;
export async function encoderFor(mime: string, width: number, height: number): Promise<VideoCodec> {
  const candidates: VideoCodec[] =
    mime === 'video/webm'
      ? ['vp9', 'av1', 'vp8']
      : mime === 'video/x-matroska'
        ? ['vp9', 'avc']
        : ['avc', 'hevc', 'av1'];
  for (const codec of candidates) {
    if (await canEncodeVideo(codec, { width, height })) return codec;
  }
  throw new MediaInputError('This browser can’t encode video for this format. Try Chrome or Edge.');
}

export const reverseVideoEngine: Engine<ReverseVideoOptions> = {
  ...MEDIA_META.reverseVideo,
  async run(file, opts, ctx): Promise<EngineOutput> {
    if (file.size > VIDEO_LIMITS.maxBytes) {
      throw new MediaInputError('This file is over 2 GB, the browser limit for video.');
    }
    const input = openInput(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new MediaInputError('This file has no video in it.');
      if (!(await video.canDecode())) {
        throw new MediaInputError(
          `This browser can’t decode ${codecLabel(await video.getCodec())} video. Try Chrome, Edge or Safari.`,
        );
      }
      const sourceAudio = opts.audio === 'mute' ? null : await input.getPrimaryAudioTrack();
      const audio = sourceAudio && (await sourceAudio.canDecode()) ? sourceAudio : null;
      const format = containerFormat(await sourceFamily(input));
      const metrics = await video.computeFrameRateMetrics().catch(() => null);
      const fps = metrics?.bestGuessFrameRate ?? 30;
      if ((await video.computeDuration()) > VIDEO_LIMITS.maxSeconds) {
        throw new MediaInputError('This video is over 60 min, the browser limit for video.');
      }
      const videoCodec = await encoderFor(
        format.mimeType,
        await video.getDisplayWidth(),
        await video.getDisplayHeight(),
      );

      const clip = await ClipFrames.read(video, fps, ctx.signal);
      const end = clip.end;
      let done = 0;
      const channels = audio ? Math.min(2, await audio.getNumberOfChannels()) : 2;
      const audioCodec = audio ? await audioCodecFor(format.mimeType, channels) : null;
      const target = new BufferTarget();
      const output = new Output({ format, target });
      output.setMetadataTags(await input.getMetadataTags());
      const videoSource = new VideoSampleSource({
        codec: videoCodec,
        quality: new Quality('high'),
      });
      output.addVideoTrack(videoSource, { frameRate: fps });
      const audioSource =
        audio && audioCodec
          ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: 160_000 }) })
          : null;
      if (audioSource) output.addAudioTrack(audioSource);
      await output.start();

      const writeVideo = async () => {
        let at = 0;
        for await (const { copy, index } of clip.backward(0, clip.count, ctx.signal)) {
          const duration = clip.duration(index);
          copy.setTimestamp(at);
          copy.setDuration(duration);
          try {
            await videoSource.add(copy);
          } finally {
            copy.close();
          }
          at += duration;
          done += 1;
          ctx.progress(Math.min(1, done / clip.count), 'Reversing');
        }
        videoSource.close();
      };

      const writeAudio = async () => {
        if (!audio || !audioSource) return;
        const rate = await audio.getSampleRate();
        const total = Math.round(end * rate);
        // The sound over the picture's length, backwards: silence where it's shorter, cut where longer.
        const pieces = reversePieces(0, total, AUDIO_WINDOW * rate, total).filter(
          (piece) => piece.reverse,
        );
        let written = 0;
        for await (const planes of reversedFrames(audio, pieces, channels, ctx.signal)) {
          const n = planes[0]?.length ?? 0;
          if (n === 0) continue;
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
          await audioSource.add(sample);
          sample.close();
          written += n;
        }
        audioSource.close();
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
      const sound = !sourceAudio
        ? opts.audio === 'mute'
          ? 'Sound left out'
          : 'This video has no sound'
        : !audio
          ? `This browser can’t decode the ${codecLabel(await sourceAudio.getCodec())} sound, so the result is silent`
          : !audioCodec
            ? 'This browser can’t encode sound for this format, so the result is silent'
            : 'Sound reversed with the picture';
      return {
        blob: new Blob([bytes], { type: format.mimeType }),
        ext: format.fileExtension.slice(1),
        durationSec: end,
        path: 'Browser · WebCodecs',
        notes: [
          `Reversed: ${String(clip.count)} frames, ${end.toFixed(2)} s`,
          `Re-encoded as ${codecLabel(videoCodec)}`,
          sound,
        ],
        details: [
          { label: 'Frames', value: String(clip.count) },
          { label: 'Length', value: `${end.toFixed(2)} s` },
        ],
      };
    } finally {
      input.dispose();
    }
  },
};
