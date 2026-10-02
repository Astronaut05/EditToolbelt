/**
 * The options each server tool takes (docs/06: "tool ids and option names are
 * part of the API contract"). The jobs API checks a job's options against
 * these before anything reaches the worker, and the worker's processors trust
 * them. Kept out of the registry's main entry so browser bundles don't carry
 * them; import `@etb/registry/options`.
 */
import { z } from 'zod';

import { WHISPER_LANGUAGE_CODES, type WhisperLanguage } from './languages';

/**
 * V02 on the server: the browser tool's settings (tools/video.md → V02), so
 * one set of choices works either way. A size is MB of 10⁶ bytes.
 */
const compressVideo = z
  .strictObject({
    /** Hit a size, or a quality level. */
    mode: z.enum(['size', 'quality']).default('size'),
    /** size mode: the file size to land just under, in MB. */
    targetMb: z.number().positive().max(100_000).optional(),
    /** quality mode. */
    quality: z.enum(['high', 'medium', 'small']).optional(),
    /** auto steps the size down when a target leaves too few bits; or the short side. */
    resolution: z.enum(['auto', 'keep', '1080', '720', '480', '360']).default('auto'),
    /** keep, or lower the frame rate. */
    fps: z.enum(['keep', '30', '24', '15']).default('keep'),
    /** MP4 with H.264, H.265 or AV1; WebM with VP9. */
    codec: z.enum(['h264', 'h265', 'av1', 'vp9']).default('h264'),
    audio: z.enum(['keep', 'remove']).default('keep'),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'size' && value.targetMb === undefined) {
      ctx.addIssue({ code: 'custom', path: ['targetMb'], message: 'required in size mode' });
    }
    if (value.mode === 'quality' && value.quality === undefined) {
      ctx.addIssue({ code: 'custom', path: ['quality'], message: 'required in quality mode' });
    }
  });

/** V15: the rate to put the frames on, the picture's quality, and the sound. */
const vfrToCfr = z.strictObject({
  /** auto: the standard rate nearest the video's average. */
  fps: z.enum(['auto', '23.976', '24', '25', '29.97', '30', '50', '59.94', '60']).default('auto'),
  /** best is visually lossless. */
  quality: z.enum(['best', 'high', 'small']).default('best'),
  audio: z.enum(['keep', 'remove']).default('keep'),
});

/** V16: the subtitle file (an upload of its own) and how SRT and VTT look; ASS keeps its styles. */
const burnSubtitles = z.strictObject({
  /** The subtitle file's upload id (POST /uploads with an SRT, VTT or ASS type). */
  subtitles: z.uuid(),
  font: z.enum(['sans', 'serif', 'mono']).default('sans'),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#ffffff'),
  outline: z.enum(['none', 'thin', 'thick']).default('thin'),
  /** A half-clear black box behind the text instead of an outline. */
  box: z.boolean().default(false),
  position: z.enum(['bottom', 'top']).default('bottom'),
  /** How far the lines may run: nearly edge to edge, or narrower. */
  width: z.enum(['full', 'narrow']).default('full'),
});

/**
 * A10: how hard to clean, mains hum, sibilance, the format. `preview` makes a
 * free preview: the upload is a snippet of at most `previewSeconds` (the page
 * cuts it), and the result comes back as WAV.
 */
const removeNoise = z.strictObject({
  /** Light, Medium, Strong: up to 12, 24 or 40 dB less noise. */
  strength: z.enum(['light', 'medium', 'strong']).default('medium'),
  /** Notches at 50 or 60 Hz and their harmonics. */
  dehum: z.enum(['off', '50', '60']).default('off'),
  /** Soften sharp s sounds. */
  deess: z.boolean().default(false),
  /** keep: the input's own format and bitrate. */
  format: z.enum(['keep', 'wav', 'flac', 'mp3', 'm4a', 'ogg']).default('keep'),
  preview: z.boolean().default(false),
});

/** The denoise levels of the Real-ESRGAN tools (P08, V20): none keeps the grain. */
const denoise = z.enum(['none', 'low', 'medium', 'high']).default('medium');

/** P08: Real-ESRGAN, 2× or 4×, a general or an illustration model, PNG, JPG or WebP. */
const upscaleImage = z.strictObject({
  scale: z.enum(['2', '4']).default('4'),
  /** general: photos and most images; anime: illustrations, drawings, anime. */
  model: z.enum(['general', 'anime']).default('general'),
  /** How much grain and JPEG noise to clean up (the general model only). */
  denoise,
  format: z.enum(['png', 'jpg', 'webp']).default('png'),
});

/**
 * P17: the mask (an upload of its own) and the result's format. The mask is a
 * PNG, white where to erase and black elsewhere, the image's size or the same
 * shape scaled; the result is the image at its full size.
 */
const objectEraser = z.strictObject({
  /** The mask's upload id (POST /uploads with image/png). */
  mask: z.uuid(),
  /** PNG keeps every pixel outside the mask exactly as it was. */
  format: z.enum(['png', 'jpg', 'webp']).default('png'),
});

/** V20: Real-ESRGAN on every frame, 2× or 4×, up to 4K, as H.264 MP4 with the sound. */
const upscaleVideo = z.strictObject({
  scale: z.enum(['2', '4']).default('2'),
  /** general: real footage; anime: animation and drawn video. */
  model: z.enum(['general', 'anime']).default('general'),
  /** How much grain and compression noise to clean up (the general model only). */
  denoise,
});

/** V21: the subject on transparency, on chroma-key green, or on a colour. */
const videoBackgroundRemover = z.strictObject({
  /** prores: ProRes 4444 MOV with alpha; webm: VP9 with alpha; green and color: H.264 MP4. */
  output: z.enum(['prores', 'webm', 'green', 'color']).default('prores'),
  /** The background for `color`. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#ffffff'),
});

/** Whisper's language codes, or auto to detect it. */
const language = z
  .enum(['auto', ...(WHISPER_LANGUAGE_CODES as [WhisperLanguage, ...WhisperLanguage[]])])
  .default('auto');

/** A12: Whisper large-v3; plain text, subtitles or JSON with every word's time. */
const transcribeAudio = z.strictObject({
  language,
  format: z.enum(['txt', 'srt', 'vtt', 'json']).default('txt'),
});

/** V17: subtitles from speech, with line limits, word timing and translation to English. */
const autoSubtitles = z.strictObject({
  language,
  /** Translate the speech to English subtitles. */
  translate: z.boolean().default(false),
  format: z.enum(['srt', 'vtt', 'ass', 'txt']).default('srt'),
  maxChars: z.number().int().min(16).max(80).default(42),
  maxLines: z.number().int().min(1).max(3).default(2),
  /** A time for every word: VTT timestamp tags, ASS karaoke. */
  words: z.boolean().default(false),
});

export const serverOptions = {
  'compress-video': compressVideo,
  'vfr-to-cfr': vfrToCfr,
  'burn-subtitles': burnSubtitles,
  'upscale-image': upscaleImage,
  'transcribe-audio': transcribeAudio,
  'auto-subtitles': autoSubtitles,
  'object-eraser': objectEraser,
  'upscale-video': upscaleVideo,
  'video-background-remover': videoBackgroundRemover,
  'remove-noise': removeNoise,
} satisfies Record<string, z.ZodType>;

/**
 * Tools with a free preview (`preview: true` in their options), and the
 * longest snippet one may send, in seconds (tools/audio.md → A10: 10 s).
 */
export const previewSeconds: Partial<Record<keyof typeof serverOptions, number>> = {
  'remove-noise': 10,
};

/** Options that name another upload, by tool: the job takes those files too, in this order. */
export const uploadOptions: Partial<Record<keyof typeof serverOptions, readonly string[]>> = {
  'burn-subtitles': ['subtitles'],
  'object-eraser': ['mask'],
};

/** Subtitle files, as the uploads API types them (by extension: browsers rarely do). */
export const SUBTITLE_MIME_TYPES = ['application/x-subrip', 'text/vtt', 'text/x-ssa'] as const;

/**
 * What each of those uploads must be: the types it may have, what to call it,
 * and the problem's title when it isn't one of them.
 */
export const uploadKinds: Partial<
  Record<
    keyof typeof serverOptions,
    Record<string, { types: readonly string[]; is: string; title: string }>
  >
> = {
  'burn-subtitles': {
    subtitles: {
      types: SUBTITLE_MIME_TYPES,
      is: 'an SRT, VTT or ASS file',
      title: 'Not a subtitle file',
    },
  },
  'object-eraser': { mask: { types: ['image/png'], is: 'a PNG', title: 'Not a PNG mask' } },
};

export type ServerToolId = keyof typeof serverOptions;
export type ServerOptions<T extends ServerToolId> = z.output<(typeof serverOptions)[T]>;

export type OptionsResult =
  { ok: true; options: Record<string, unknown> } | { ok: false; error: string };

/** A tool's options, checked and with defaults filled in; `{}` for tools that take none. */
export function parseServerOptions(toolId: string, input: unknown): OptionsResult {
  const schema = (serverOptions as Record<string, z.ZodType>)[toolId] ?? z.strictObject({});
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return { ok: true, options: parsed.data as Record<string, unknown> };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${issue?.path.join('.') || 'options'}: ${issue?.message ?? ''}` };
}
