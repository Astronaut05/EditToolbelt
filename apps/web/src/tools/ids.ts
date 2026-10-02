import type { CategoryId } from '@etb/registry';

/**
 * Ids of the tools that have a view in src/tools, by registry category. A
 * plain module, so server code can read it (exports of the 'use client'
 * modules are client references). Each category's index in ./views is typed
 * against its list here, so the two can't drift; lib/tool.test.ts checks that
 * every id sits under its tool's registry category.
 */
export const VIEW_IDS = {
  photo: [
    'compress-image',
    'crop-image',
    'exif-remover',
    'image-converter',
    'object-eraser',
    'remove-background',
    'resize-image',
    'rotate-image',
    'social-media-image-resizer',
    'split-image',
    'upscale-image',
    'watermark-image',
  ],
  video: [
    'auto-subtitles',
    'burn-subtitles',
    'compress-video',
    'extract-audio',
    'extract-frames',
    'gif-to-mp4',
    'merge-videos',
    'mute-video',
    'replace-audio',
    'resize-video',
    'rotate-video',
    'trim-video',
    'upscale-video',
    'vfr-to-cfr',
    'video-background-remover',
    'video-converter',
    'video-info',
    'video-speed',
    'video-to-gif',
  ],
  audio: [
    'audio-channels',
    'audio-converter',
    'bpm-key-finder',
    'change-pitch',
    'fade-audio',
    'loudness-meter',
    'merge-audio',
    'normalize-audio',
    'remove-silence',
    'transcribe-audio',
    'trim-audio',
  ],
  color: [
    'color-converter',
    'color-palette-from-image',
    'color-picker-from-image',
    'contrast-checker',
    'lut-preview',
  ],
  'subtitles-time': [
    'aspect-ratio-calculator',
    'bitrate-calculator',
    'subtitle-converter',
    'subtitle-shift',
    'timecode-calculator',
  ],
  utility: ['batch-rename', 'dpi-calculator', 'qr-code-generator'],
} as const satisfies Record<CategoryId, readonly string[]>;

/** The ids of one category's views. */
export type ViewIds<Category extends CategoryId> = (typeof VIEW_IDS)[Category][number];

export type ToolId = ViewIds<CategoryId>;

export const TOOL_IDS: readonly ToolId[] = Object.values(VIEW_IDS).flat();

export function hasView(id: string): id is ToolId {
  return (TOOL_IDS as readonly string[]).includes(id);
}
