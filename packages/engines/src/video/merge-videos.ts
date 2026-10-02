/**
 * V12 Merge Videos (tools/video.md): clips joined in order into one file.
 *
 * - Fast: when every clip has the same video codec, settings and size (and
 *   the same audio, or none), their packets are copied end to end, each
 *   clip after the last one's picture ends. Nothing is re-encoded, so it's
 *   quick and lossless. Each clip's sound starts exactly with its picture
 *   (`placeCopiedSound`), so nothing drifts however many clips are joined.
 * - Re-encode: otherwise, or with a crossfade, every frame is drawn on one
 *   constant clock at the target size and frame rate (the first clip's, or
 *   one chosen), fitted on black, and the sound of each clip is brought to
 *   48 kHz and laid under its own picture, so nothing drifts.
 */
import { placedGain, placeJoined, type Placement } from '@etb/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  type AudioCodec,
  type Input,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoCodec,
} from 'mediabunny';

import { Frames, framesOf } from '../audio/stream';
import { EngineAbortError } from '../dummy';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { even, Held, shownFor } from './held';
import { VIDEO_LIMITS } from './limits';
import { codecLabel, MediaInputError, openInput } from './media';
import { containerFormat, sourceFamily } from './trim';

export interface MergeVideosOptions {
  /** The clips, in order (the shell's file list). */
  files?: Blob[];
  /** none or crossfade. */
  transition?: string;
  /** Crossfade seconds. */
  transitionLength?: string;
  /** first (the first clip's), or a height: 2160, 1080, 720, 480. */
  size?: string;
  /** first, or a frame rate: 24, 25, 30, 50, 60. */
  fps?: string;
}

export const MERGE_VIDEO_MAX = 20;
const RATE = 48_000;
const AUDIO_BLOCK = 4800;

interface Clip {
  name: string;
  input: Input;
  video: InputVideoTrack;
  audio: InputAudioTrack | null;
  duration: number;
  width: number;
  height: number;
  fps: number;
}

// No SharedArrayBuffer by name: the site isn't cross-origin isolated, so it isn't defined.
const bytesOf = (data: AllowSharedBufferSource | undefined): Uint8Array | null =>
  !data
    ? null
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

/** Whether two clips' tracks can sit in one track as they are. */
async function sameVideo(a: InputVideoTrack, b: InputVideoTrack): Promise<boolean> {
  const [ca, cb] = [await a.getDecoderConfig(), await b.getDecoderConfig()];
  if (!ca || !cb) return false;
  return (
    ca.codec === cb.codec &&
    ca.codedWidth === cb.codedWidth &&
    ca.codedHeight === cb.codedHeight &&
    sameBytes(bytesOf(ca.description), bytesOf(cb.description)) &&
    (await a.getRotation()) === (await b.getRotation())
  );
}

async function sameAudio(a: InputAudioTrack | null, b: InputAudioTrack | null): Promise<boolean> {
  if (!a || !b) return a === b;
  const [ca, cb] = [await a.getDecoderConfig(), await b.getDecoderConfig()];
  if (!ca || !cb) return false;
  return (
    ca.codec === cb.codec &&
    ca.sampleRate === cb.sampleRate &&
    ca.numberOfChannels === cb.numberOfChannels &&
    sameBytes(bytesOf(ca.description), bytesOf(cb.description))
  );
}

async function openClips(files: Blob[]): Promise<Clip[]> {
  const clips: Clip[] = [];
  try {
    for (const [i, file] of files.entries()) {
      const name = file instanceof File ? file.name : `Clip ${String(i + 1)}`;
      const input = openInput(file);
      try {
        if (!(await input.canRead().catch(() => false))) {
          throw new MediaInputError(
            `${name} isn’t a video this tool can read. Try MP4, MOV, WebM or MKV.`,
          );
        }
        const video = await input.getPrimaryVideoTrack();
        if (!video) throw new MediaInputError(`${name} has no video in it.`);
        const metrics = await video.computeFrameRateMetrics().catch(() => null);
        const fps = metrics?.bestGuessFrameRate ?? 30;
        clips.push({
          name,
          input,
          video,
          audio: await input.getPrimaryAudioTrack(),
          duration: await shownFor(video, fps),
          width: await video.getDisplayWidth(),
          height: await video.getDisplayHeight(),
          fps,
        });
      } catch (error) {
        input.dispose();
        throw error;
      }
    }
    return clips;
  } catch (error) {
    for (const c of clips) c.input.dispose();
    throw error;
  }
}

const STANDARD_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

/** The nearest standard rate: phones say 29.98, cameras 23.976. */
function standardFps(fps: number): number {
  return STANDARD_FPS.reduce(
    (best, f) => (Math.abs(f - fps) < Math.abs(best - fps) ? f : best),
    30,
  );
}

/** A packet's start and length, seconds. */
export interface PacketTiming {
  timestamp: number;
  duration: number;
}

/**
 * How far a sound packet may run past its clip's picture and still be kept:
 * Matroska times are whole milliseconds, so a clip's end can be 1 ms out.
 */
const SPILL = 0.001;

/**
 * Where one of a clip's sound packets goes in a fast join, or why it's left out:
 * - `end`: it starts once the clip's picture has ended, as does every packet after it.
 * - `skip`: an encoder's priming before a later clip's start (AAC's first
 *   1024 samples, which the container's edit list hides; copied, they would
 *   play as 21 ms of extra sound), or a packet that would run past the
 *   clip's end. Placed whole, either would make every clip after it late.
 *   PCM (`cut`) can be cut short at the end instead, losslessly.
 * - Otherwise its start and length in the joined file: at the clip's own
 *   offset, never before the packet placed before it (`previous`).
 */
export function placeCopiedSound(
  packet: PacketTiming,
  clip: { offset: number; duration: number; first: boolean },
  previous: number,
  cut = false,
): PacketTiming | 'skip' | 'end' {
  if (packet.timestamp >= clip.duration - 1e-9) return 'end';
  if (!clip.first && packet.timestamp + packet.duration <= 1e-9) return 'skip';
  let duration = packet.duration;
  if (packet.timestamp + duration > clip.duration + SPILL) {
    if (!cut) return 'skip';
    duration = clip.duration - packet.timestamp;
  }
  return { timestamp: Math.max(previous, clip.offset + packet.timestamp), duration };
}

/** Where the primary video and sound tracks' last packets end, seconds: a join's sync, for tests. */
export async function trackEnds(file: Blob): Promise<{ video: number; audio: number | null }> {
  const input = openInput(file);
  const endOf = async (track: InputVideoTrack | InputAudioTrack) => {
    let end = 0;
    for await (const packet of new EncodedPacketSink(track).packets()) {
      end = Math.max(end, packet.timestamp + packet.duration);
    }
    return end;
  };
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      video: video ? await endOf(video) : 0,
      audio: audio ? await endOf(audio) : null,
    };
  } finally {
    input.dispose();
  }
}

/** Bytes per sample frame of uncompressed audio, which can be cut anywhere; 0 for coded audio. */
function pcmFrameBytes(codec: AudioCodec, channels: number): number {
  const size: Partial<Record<AudioCodec, number>> = {
    'pcm-u8': 1,
    'pcm-s8': 1,
    ulaw: 1,
    alaw: 1,
    'pcm-s16': 2,
    'pcm-s16be': 2,
    'pcm-s24': 3,
    'pcm-s24be': 3,
    'pcm-s32': 4,
    'pcm-s32be': 4,
    'pcm-f32': 4,
    'pcm-f32be': 4,
    'pcm-f64': 8,
    'pcm-f64be': 8,
  };
  return (size[codec] ?? 0) * channels;
}

/** Copies every clip's packets end to end: no decoding, no re-encoding. */
async function copyJoin(clips: Clip[], signal: AbortSignal, progress: (f: number) => void) {
  const first = clips[0] as Clip;
  const format = containerFormat(await sourceFamily(first.input));
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const videoCodec = (await first.video.getCodec()) as VideoCodec;
  const videoSource = new EncodedVideoPacketSource(videoCodec);
  output.addVideoTrack(videoSource, {
    ...(format.supportsVideoTransformationMetadata && {
      transformationMatrix: await first.video.getTransformationMatrix(),
    }),
  });
  const audioCodec = first.audio ? ((await first.audio.getCodec()) as AudioCodec) : null;
  const audioSource = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  const total = clips.reduce((sum, c) => sum + c.duration, 0);
  const writeVideo = async () => {
    const config = await first.video.getDecoderConfig();
    let offset = 0;
    let firstPacket = true;
    for (const clip of clips) {
      for await (const packet of new EncodedPacketSink(clip.video).packets()) {
        if (signal.aborted) throw new EngineAbortError();
        await videoSource.add(
          packet.clone({ timestamp: packet.timestamp + offset }),
          firstPacket && config ? { decoderConfig: config } : undefined,
        );
        firstPacket = false;
        progress((offset + packet.timestamp) / total);
      }
      offset += clip.duration;
    }
    videoSource.close();
  };
  const writeAudio = async () => {
    if (!audioSource || !first.audio || !audioCodec) return;
    const config = await first.audio.getDecoderConfig();
    const rate = await first.audio.getSampleRate();
    const frameBytes = pcmFrameBytes(audioCodec, await first.audio.getNumberOfChannels());
    let offset = 0;
    let firstPacket = true;
    let previous = -Infinity;
    for (const [i, clip] of clips.entries()) {
      if (clip.audio) {
        for await (const packet of new EncodedPacketSink(clip.audio).packets()) {
          if (signal.aborted) throw new EngineAbortError();
          const place = placeCopiedSound(
            packet,
            { offset, duration: clip.duration, first: i === 0 },
            previous,
            frameBytes > 0,
          );
          if (place === 'end') break;
          if (place === 'skip') continue;
          let copy = packet.clone({ timestamp: place.timestamp });
          if (place.duration < packet.duration) {
            // PCM past the picture's end: only the frames before it.
            const frames = Math.floor(place.duration * rate + 1e-6);
            if (frames <= 0) continue;
            copy = packet.clone({
              timestamp: place.timestamp,
              duration: frames / rate,
              data: packet.data.subarray(0, frames * frameBytes),
            });
          }
          await audioSource.add(
            copy,
            firstPacket && config ? { decoderConfig: config } : undefined,
          );
          firstPacket = false;
          previous = place.timestamp;
        }
      }
      offset += clip.duration;
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
  const bytes = target.buffer;
  if (!bytes) throw new Error('No file was written');
  return { bytes, mime: format.mimeType, ext: format.fileExtension.slice(1), length: total };
}

async function videoCodecFor(mime: string, width: number, height: number): Promise<VideoCodec> {
  const candidates: VideoCodec[] =
    mime === 'video/webm'
      ? ['vp9', 'av1', 'vp8']
      : mime === 'video/x-matroska'
        ? ['vp9', 'avc', 'av1']
        : ['avc', 'hevc', 'av1'];
  for (const codec of candidates) {
    if (await canEncodeVideo(codec, { width, height })) return codec;
  }
  throw new MediaInputError(
    `This browser can’t encode video for ${mime === 'video/webm' ? 'WebM' : mime === 'video/x-matroska' ? 'MKV' : 'MP4'}. Try Chrome, Edge or Safari.`,
  );
}

async function audioCodecFor(mime: string): Promise<AudioCodec | null> {
  const candidates: AudioCodec[] =
    mime === 'video/webm' ? ['opus'] : mime === 'video/x-matroska' ? ['opus', 'aac'] : ['aac'];
  for (const codec of candidates) {
    if (await canEncodeAudio(codec, { sampleRate: RATE, numberOfChannels: 2 })) return codec;
  }
  return null;
}

/** Draws every frame again on one clock, with crossfades if asked; the sound follows each clip. */
async function encodeJoin(
  clips: Clip[],
  opts: { width: number; height: number; fps: number; crossfade: number },
  signal: AbortSignal,
  progress: (f: number) => void,
) {
  const first = clips[0] as Clip;
  const format = containerFormat(await sourceFamily(first.input));
  const { width, height, fps } = opts;
  const videoCodec = await videoCodecFor(format.mimeType, width, height);
  const withSound = clips.some((c) => c.audio);
  const audioCodec = withSound ? await audioCodecFor(format.mimeType) : null;
  const frameCount = (seconds: number) => Math.max(1, Math.round(seconds * fps));
  const crossfadeFrames = Math.round(opts.crossfade * fps);
  let placed: Placement[];
  try {
    placed = placeJoined(
      clips.map((c) => frameCount(c.duration)),
      crossfadeFrames > 0 ? 'crossfade' : 'cut',
      crossfadeFrames,
    );
  } catch {
    throw new MediaInputError('A crossfade can be at most half as long as the shortest clip.');
  }
  const total = placed.reduce((end, p) => Math.max(end, p.at + p.length), 0);

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new VideoSampleSource({ codec: videoCodec, quality: new Quality('high') });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec
    ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: 192_000 }) })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const writeVideo = async () => {
    // A clip's decoder opens at its first frame and closes after its last:
    // at most two are open at once, in a crossfade.
    const held: (Held | null)[] = clips.map(() => null);
    try {
      for (let n = 0; n < total; n += 1) {
        if (signal.aborted) throw new EngineAbortError();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        let drawn = 0;
        for (const [i, p] of placed.entries()) {
          const clip = clips[i];
          if (n < p.at || n >= p.at + p.length || !clip) continue;
          const reader = (held[i] ??= new Held(clip.video));
          const frame = await reader.at((n - p.at) / fps);
          if (frame) {
            // The incoming clip fades in over the outgoing one.
            ctx.globalAlpha =
              drawn > 0 && p.fadeIn > 0 ? Math.min(1, (n - p.at + 0.5) / p.fadeIn) : 1;
            frame.drawWithFit(ctx, { fit: 'contain' });
            drawn += 1;
          }
          if (n === p.at + p.length - 1) {
            reader.close();
            held[i] = null;
          }
        }
        const sample = new VideoSample(canvas, { timestamp: n / fps, duration: 1 / fps });
        await videoSource.add(sample);
        sample.close();
        progress((n + 1) / total);
      }
    } finally {
      for (const h of held) h?.close();
    }
    videoSource.close();
  };

  const writeAudio = async () => {
    if (!audioSource) return;
    // Each clip's sound is cut or padded to its own picture's length, so A and V stay together.
    const audioPlaced = placed.map((p) => ({
      ...p,
      at: Math.round((p.at / fps) * RATE),
      length: Math.round((p.length / fps) * RATE),
      fadeIn: Math.round((p.fadeIn / fps) * RATE),
      fadeOut: Math.round((p.fadeOut / fps) * RATE),
    }));
    const readers = clips.map((c, i) =>
      c.audio
        ? new Frames(
            framesOf(
              c.audio,
              [{ from: 0, to: (audioPlaced[i]?.length ?? 0) / RATE, at: 0 }],
              RATE,
              2,
              signal,
            ),
            2,
          )
        : null,
    );
    const end = Math.round((total / fps) * RATE);
    for (let start = 0; start < end; start += AUDIO_BLOCK) {
      if (signal.aborted) throw new EngineAbortError();
      const n = Math.min(AUDIO_BLOCK, end - start);
      const planes = [new Float32Array(n), new Float32Array(n)];
      for (const [i, p] of audioPlaced.entries()) {
        const from = Math.max(start, p.at);
        const to = Math.min(start + n, p.at + p.length);
        const reader = readers[i];
        if (to <= from || !reader) continue;
        const got = await reader.take(to - from);
        for (let j = 0; j < to - from; j += 1) {
          const g = placedGain(p, from - p.at + j);
          for (let c = 0; c < 2; c += 1) {
            const plane = planes[c] as Float32Array;
            plane[from - start + j] = (plane[from - start + j] ?? 0) + (got[c]?.[j] ?? 0) * g;
          }
        }
      }
      const data = new Float32Array(n * 2);
      data.set(planes[0] as Float32Array, 0);
      data.set(planes[1] as Float32Array, n);
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: RATE,
        timestamp: start / RATE,
      });
      await audioSource.add(sample);
      sample.close();
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
  const bytes = target.buffer;
  if (!bytes) throw new Error('No file was written');
  return {
    bytes,
    mime: format.mimeType,
    ext: format.fileExtension.slice(1),
    length: total / fps,
    videoCodec,
    audioCodec,
    lostSound: withSound && !audioCodec,
  };
}

const secs = (t: number) => `${t.toFixed(t < 10 ? 2 : 1)} s`;

export const mergeVideosEngine: Engine<MergeVideosOptions> = {
  ...MEDIA_META.mergeVideos,
  async run(_file, opts, ctx): Promise<EngineOutput> {
    const files = opts.files ?? [];
    if (files.length < 2) throw new MediaInputError('Add at least 2 clips to merge.');
    if (files.length > MERGE_VIDEO_MAX) {
      throw new MediaInputError(`Merge up to ${String(MERGE_VIDEO_MAX)} clips at once.`);
    }
    // The joined file is built in memory: the clips together stay within the browser limit.
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    if (bytes > VIDEO_LIMITS.maxBytes) {
      throw new MediaInputError(
        `These clips come to ${(Math.ceil((bytes / 1024 ** 3) * 10) / 10).toFixed(1)} GB together, over the browser limit of ${String(VIDEO_LIMITS.maxBytes / 1024 ** 3)} GB. Merge fewer at a time.`,
      );
    }
    const clips = await openClips(files);
    try {
      const first = clips[0] as Clip;
      const crossfade =
        opts.transition === 'crossfade' ? Math.max(0, Number(opts.transitionLength) || 0) : 0;
      const chosenSize = Number(opts.size);
      const chosenFps = Number(opts.fps);
      // Copy needs matching tracks, no transition and no new size or rate.
      let copy = crossfade === 0 && !(chosenSize > 0) && !(chosenFps > 0);
      for (const clip of clips.slice(1)) {
        if (!copy) break;
        copy =
          (await sameVideo(first.video, clip.video)) && (await sameAudio(first.audio, clip.audio));
      }
      if (copy) {
        const out = await copyJoin(clips, ctx.signal, (f) => {
          ctx.progress(f, 'Joining');
        });
        return {
          blob: new Blob([out.bytes], { type: out.mime }),
          ext: out.ext,
          durationSec: out.length,
          path: 'Browser · stream copy',
          nameSuffix: 'merged',
          notes: [
            `${String(clips.length)} clips joined: ${secs(out.length)}`,
            'The clips share their codec and settings, so every packet is copied: nothing re-encoded, nothing lost',
          ],
          details: [
            { label: 'Clips', value: String(clips.length) },
            { label: 'Length', value: secs(out.length) },
            { label: 'Join', value: 'Copied, no re-encode' },
          ],
        };
      }
      for (const clip of clips) {
        if (!(await clip.video.canDecode())) {
          throw new MediaInputError(
            `This browser can’t decode ${clip.name}’s ${codecLabel(await clip.video.getCodec())} video, so the clips can’t be re-encoded to one spec. Try Chrome, Edge or Safari.`,
          );
        }
        if (clip.audio && !(await clip.audio.canDecode())) {
          throw new MediaInputError(
            `This browser can’t decode ${clip.name}’s ${codecLabel(await clip.audio.getCodec())} sound. Try Chrome, Edge or Safari.`,
          );
        }
      }
      const height = chosenSize > 0 ? even(chosenSize) : even(first.height);
      const width =
        chosenSize > 0 ? even((first.width * height) / first.height) : even(first.width);
      const fps = chosenFps > 0 ? chosenFps : standardFps(first.fps);
      const out = await encodeJoin(clips, { width, height, fps, crossfade }, ctx.signal, (f) => {
        ctx.progress(f, 'Re-encoding');
      });
      const notes = [
        crossfade > 0
          ? `${String(clips.length)} clips joined with ${secs(crossfade)} crossfades: ${secs(out.length)}`
          : `${String(clips.length)} clips joined: ${secs(out.length)}`,
        `Re-encoded to ${String(width)} × ${String(height)} at ${String(fps)} fps, ${codecLabel(out.videoCodec)}${out.audioCodec ? ` with ${codecLabel(out.audioCodec)} sound` : ''}; clips of another shape are fitted on black`,
      ];
      if (out.lostSound)
        notes.push('This browser can’t encode sound for this format, so the result is silent');
      return {
        blob: new Blob([out.bytes], { type: out.mime }),
        ext: out.ext,
        durationSec: out.length,
        width,
        height,
        path: 'Browser · WebCodecs',
        nameSuffix: 'merged',
        notes,
        details: [
          { label: 'Clips', value: String(clips.length) },
          { label: 'Length', value: secs(out.length) },
          { label: 'Output', value: `${String(width)} × ${String(height)} · ${String(fps)} fps` },
        ],
      };
    } finally {
      for (const c of clips) c.input.dispose();
    }
  },
};
