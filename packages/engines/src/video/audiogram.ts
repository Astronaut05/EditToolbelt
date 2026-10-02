/**
 * A16 Audio to Video (tools/audio.md): an audiogram. The selected stretch of
 * audio is read twice: once to see what it looks like at each frame
 * (@etb/core's AudiogramAnalyser: spectrum bars and waveform), once to go
 * into the video as its sound. Each frame is drawn on a canvas (a colour or
 * an image, the title, the bars or the wave, the caption showing then) and
 * encoded with WebCodecs: H.264 and AAC in MP4 where the browser can, else
 * VP9 and Opus in WebM.
 */
import { audiogram, Resampler, subtitles } from '@etb/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';

import { EngineAbortError } from '../dummy';
import { cssFont, loadTextFont } from '../image/text-layer';
import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput } from '../types';
import { MediaInputError, openInput } from './media';
import { spliceAudio } from './splice-audio';

export interface AudioToVideoOptions {
  /** The timeline's selection, seconds. */
  start?: number;
  end?: number;
  /** portrait (9:16), square (1:1) or landscape (16:9). */
  size?: string;
  /** bars (spectrum) or wave (waveform line). */
  style?: string;
  /** The bars' or the wave's colour, "#rrggbb". */
  color?: string;
  /** Behind everything, "#rrggbb". */
  background?: string;
  /** A picture behind the sound, filling the frame. */
  image?: File;
  title?: string;
  /** Captions: SRT, VTT, ASS or SBV, timed to the whole file. */
  captions?: File;
  /** mp4 (H.264 and AAC) or webm (VP9 and Opus). */
  format?: string;
}

const { AUDIOGRAM_FPS: FPS, BARS, WAVE_POINTS } = audiogram;
const OUT_RATE = 48_000;

const hex = (value: string | undefined, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value ?? '') ? (value ?? fallback) : fallback;

/** Relative luminance of "#rrggbb", 0 (black) to 1 (white). */
function luminance(colour: string): number {
  const v = parseInt(colour.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
}

const secs = (s: number) => `${s.toFixed(1)} s`;

/** The codecs this browser can write: MP4 if asked and possible, else WebM. */
async function codecsFor(
  wantMp4: boolean,
  width: number,
  height: number,
  channels: number,
): Promise<{ mp4: boolean; video: VideoCodec; audio: AudioCodec }> {
  const audioOk = (codec: AudioCodec) =>
    canEncodeAudio(codec, { sampleRate: OUT_RATE, numberOfChannels: channels });
  if (wantMp4 && (await canEncodeVideo('avc', { width, height })) && (await audioOk('aac'))) {
    return { mp4: true, video: 'avc', audio: 'aac' };
  }
  for (const video of ['vp9', 'vp8'] as const) {
    if ((await canEncodeVideo(video, { width, height })) && (await audioOk('opus'))) {
      return { mp4: false, video, audio: 'opus' };
    }
  }
  throw new MediaInputError(
    'This browser can’t encode video with sound here. Try a current Chrome, Edge or Safari.',
  );
}

async function readCaptions(file: File | undefined): Promise<subtitles.Cue[]> {
  if (!file) return [];
  const text = await file.text();
  const format = subtitles.detectFormat(text, file.name);
  if (!format || format === 'txt') {
    throw new MediaInputError(
      `${file.name} isn’t a captions file this tool reads. Use SRT, VTT, ASS or SBV.`,
    );
  }
  return subtitles.parseSubtitles(text, format).cues;
}

/** The planes of a block of audio, as f32. */
function planesOf(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, c) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    return plane;
  });
}

interface Look {
  width: number;
  height: number;
  style: 'bars' | 'wave';
  color: string;
  background: string;
  image: ImageBitmap | null;
  title: string;
  ink: string;
}

/** Draws frame `k`: background, title, the sound, the caption. */
function drawFrame(
  g: OffscreenCanvasRenderingContext2D,
  look: Look,
  layout: audiogram.AudiogramLayout,
  features: audiogram.AudiogramFeatures,
  k: number,
  caption: string | null,
): void {
  const { width, height } = look;
  g.fillStyle = look.background;
  g.fillRect(0, 0, width, height);
  if (look.image) {
    const { width: iw, height: ih } = look.image;
    const scale = Math.max(width / iw, height / ih);
    const w = width / scale;
    const h = height / scale;
    g.drawImage(look.image, (iw - w) / 2, (ih - h) / 2, w, h, 0, 0, width, height);
    // Darkened, so the sound and the words stand out on any picture.
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    g.fillRect(0, 0, width, height);
  }

  const measureWith = (font: string) => {
    g.font = font;
    return (text: string) => g.measureText(text).width;
  };

  if (look.title) {
    const box = layout.title;
    const font = cssFont({ font: 'onest', bold: true }, box.size);
    const lines = audiogram.wrapLines(look.title, box.width, measureWith(font), 3);
    const lineHeight = box.size * 1.2;
    g.font = font;
    g.fillStyle = look.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const top = box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      g.fillText(line, width / 2, top + i * lineHeight);
    });
  }

  const v = layout.visual;
  const mid = v.y + v.height / 2;
  g.fillStyle = look.color;
  g.strokeStyle = look.color;
  if (look.style === 'bars') {
    const pitch = v.width / BARS;
    const barWidth = pitch * 0.62;
    for (let b = 0; b < BARS; b += 1) {
      const level = features.bars[k * BARS + b] ?? 0;
      const h = Math.max(barWidth, level * v.height);
      const x = v.x + b * pitch + (pitch - barWidth) / 2;
      g.beginPath();
      g.roundRect(x, mid - h / 2, barWidth, h, barWidth / 2);
      g.fill();
    }
  } else {
    g.lineWidth = Math.max(3, Math.round(Math.min(width, height) * 0.008));
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (let p = 0; p < WAVE_POINTS; p += 1) {
      const x = v.x + (p * v.width) / (WAVE_POINTS - 1);
      const y = mid - (features.wave[k * WAVE_POINTS + p] ?? 0) * (v.height / 2);
      if (p === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  if (caption) {
    const box = layout.captions;
    const font = cssFont({ font: 'onest', bold: true }, box.size);
    const pad = box.size * 0.4;
    const lines = audiogram.wrapLines(caption, box.width - 2 * pad, measureWith(font), 3);
    const lineHeight = box.size * 1.25;
    g.font = font;
    const textWidth = Math.max(...lines.map((line) => g.measureText(line).width));
    const blockHeight = lines.length * lineHeight + 2 * pad;
    const top = box.y + (box.height - blockHeight) / 2;
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.beginPath();
    g.roundRect((width - textWidth) / 2 - pad, top, textWidth + 2 * pad, blockHeight, pad);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      g.fillText(line, width / 2, top + pad + (i + 0.5) * lineHeight);
    });
  }
}

export const audioToVideoEngine: Engine<AudioToVideoOptions> = {
  ...MEDIA_META.audioToVideo,
  async run(file, opts, ctx): Promise<EngineOutput> {
    const input = openInput(file);
    let image: ImageBitmap | null = null;
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new MediaInputError('This file has no sound in it.');
      if (!(await track.canDecode())) {
        throw new MediaInputError(
          'This browser can’t decode this audio. Try Chrome, Edge or Safari.',
        );
      }
      const duration = await track.computeDuration();
      const start = Math.max(0, Math.min(duration, opts.start ?? 0));
      const end = Math.max(start, Math.min(duration, opts.end ?? duration));
      const length = end - start;
      if (length < 0.5) throw new MediaInputError('Select at least half a second of audio.');
      if (length > audiogram.MAX_AUDIOGRAM_SECONDS + 0.05) {
        throw new MediaInputError(
          `That’s ${secs(length)}; an audiogram here is up to 10 minutes. Select a shorter part on the timeline.`,
        );
      }
      const shape = (['portrait', 'square', 'landscape'] as const).find((s) => s === opts.size);
      const { width, height } = audiogram.AUDIOGRAM_SIZES[shape ?? 'portrait'];
      const channels = Math.min(2, await track.getNumberOfChannels());
      const cues = await readCaptions(opts.captions);
      if (opts.image) {
        try {
          image = await createImageBitmap(opts.image, { imageOrientation: 'from-image' });
        } catch (error) {
          throw new MediaInputError(
            `${opts.image.name} can’t be opened as a picture in this browser. Try JPG, PNG or WebP.`,
            { cause: error },
          );
        }
      }
      const title = (opts.title ?? '').trim();
      await loadTextFont({
        font: 'onest',
        bold: true,
        text: `${title} ${cues.map((c) => c.text).join(' ')}`,
      });
      const codecs = await codecsFor(opts.format !== 'webm', width, height, channels);
      const frames = Math.max(1, Math.round(length * FPS));

      // 1. What the sound looks like at each frame.
      // Made with the first block, at the rate the decoder gives.
      const listen: { analyser: audiogram.AudiogramAnalyser | null } = { analyser: null };
      await spliceAudio(
        track,
        { spans: [{ start, end }], crossfade: 0 },
        (sample) => {
          listen.analyser ??= new audiogram.AudiogramAnalyser(sample.sampleRate, frames);
          const planes = planesOf(sample);
          const mono = new Float32Array(sample.numberOfFrames);
          for (const plane of planes) {
            for (let i = 0; i < mono.length; i += 1) {
              mono[i] = (mono[i] ?? 0) + (plane[i] ?? 0) / planes.length;
            }
          }
          listen.analyser.push(mono);
          return Promise.resolve();
        },
        ctx.signal,
        (fraction) => {
          ctx.progress(fraction * 0.15, 'Listening');
        },
      );
      if (!listen.analyser) throw new MediaInputError('No sound could be read from this part.');
      const features = listen.analyser.finish();

      // 2. The video: each frame drawn, and the sound under it.
      const target = new BufferTarget();
      const output = new Output({
        format: codecs.mp4
          ? new Mp4OutputFormat({ fastStart: 'in-memory' })
          : new WebMOutputFormat(),
        target,
      });
      const canvas = new OffscreenCanvas(width, height);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('No 2D canvas in this browser');
      const video = new CanvasSource(canvas, {
        codec: codecs.video,
        quality: new Quality('high'),
        keyFrameInterval: 2,
      });
      const audio = new AudioSampleSource({
        codec: codecs.audio,
        quality: new Quality({ bitrate: channels === 2 ? 192_000 : 128_000 }),
      });
      output.addVideoTrack(video, { frameRate: FPS });
      output.addAudioTrack(audio);
      await output.start();

      const background = hex(opts.background, '#101418');
      const look: Look = {
        width,
        height,
        style: opts.style === 'wave' ? 'wave' : 'bars',
        color: hex(opts.color, '#7dd3fc'),
        background,
        image,
        title,
        ink: !image && luminance(background) > 0.5 ? '#111111' : '#ffffff',
      };
      const layout = audiogram.audiogramLayout(width, height);

      const writeVideo = async () => {
        for (let k = 0; k < frames; k += 1) {
          if (ctx.signal.aborted) throw new EngineAbortError();
          const t = (k + 0.5) / FPS;
          drawFrame(g, look, layout, features, k, audiogram.cueAt(cues, start + t));
          await video.add(k / FPS, 1 / FPS);
          ctx.progress(0.15 + (0.85 * (k + 1)) / frames, 'Drawing the video', {
            step: `${String(k + 1)} of ${String(frames)} frames`,
          });
        }
        video.close();
      };
      const writeAudio = async () => {
        const to48: { resampler: Resampler | null } = { resampler: null };
        let at = 0;
        const put = async (planes: Float32Array[]) => {
          const n = planes[0]?.length ?? 0;
          if (n === 0) return;
          const data = new Float32Array(n * channels);
          for (let c = 0; c < channels; c += 1) {
            data.set(planes[Math.min(c, planes.length - 1)] ?? new Float32Array(n), c * n);
          }
          const sample = new AudioSample({
            data,
            format: 'f32-planar',
            numberOfChannels: channels,
            sampleRate: OUT_RATE,
            timestamp: at / OUT_RATE,
          });
          at += n;
          try {
            await audio.add(sample);
          } finally {
            sample.close();
          }
        };
        await spliceAudio(
          track,
          { spans: [{ start, end }] },
          async (sample) => {
            const planes = planesOf(sample).slice(0, channels);
            if (sample.sampleRate === OUT_RATE) {
              await put(planes);
              return;
            }
            to48.resampler ??= new Resampler(sample.sampleRate, OUT_RATE, planes.length);
            await put(to48.resampler.push(planes));
          },
          ctx.signal,
          () => undefined,
        );
        if (to48.resampler) await put(to48.resampler.flush());
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
      ctx.progress(1, 'Done');
      const size = audiogram.AUDIOGRAM_SIZES[shape ?? 'portrait'];
      return {
        blob: new Blob([bytes], { type: codecs.mp4 ? 'video/mp4' : 'video/webm' }),
        ext: codecs.mp4 ? 'mp4' : 'webm',
        width,
        height,
        durationSec: length,
        path: 'Browser · WebCodecs',
        notes: [
          `${size.label}, ${String(width)} × ${String(height)} px at ${String(FPS)} fps, ${secs(length)}`,
          codecs.mp4
            ? 'H.264 video and AAC sound, in MP4'
            : opts.format === 'webm'
              ? 'VP9 video and Opus sound, in WebM'
              : 'This browser can’t write MP4 with sound, so it’s VP9 and Opus in WebM',
          ...(cues.length > 0 ? [`Captions from ${opts.captions?.name ?? 'the file'}`] : []),
        ],
        details: [
          { label: 'Size', value: `${String(width)} × ${String(height)} px` },
          { label: 'Length', value: secs(length) },
        ],
      };
    } finally {
      image?.close();
      input.dispose();
    }
  },
};
