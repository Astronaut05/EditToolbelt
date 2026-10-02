/**
 * Ids of the tools that have a view in src/tools. A plain module, so server
 * code can read it (exports of the 'use client' map are client references).
 * The map in ./index.tsx is typed against this list, so the two can't drift.
 */
export const TOOL_IDS = [
  'aspect-ratio-calculator',
  'audio-channels',
  'audio-converter',
  'auto-subtitles',
  'batch-rename',
  'bitrate-calculator',
  'bpm-key-finder',
  'change-pitch',
  'burn-subtitles',
  'color-converter',
  'color-palette-from-image',
  'color-picker-from-image',
  'compress-image',
  'compress-video',
  'contrast-checker',
  'crop-image',
  'dpi-calculator',
  'exif-remover',
  'extract-audio',
  'extract-frames',
  'fade-audio',
  'gif-to-mp4',
  'image-converter',
  'loudness-meter',
  'lut-preview',
  'merge-audio',
  'merge-videos',
  'mute-video',
  'normalize-audio',
  'qr-code-generator',
  'remove-background',
  'remove-silence',
  'replace-audio',
  'resize-image',
  'resize-video',
  'rotate-image',
  'rotate-video',
  'social-media-image-resizer',
  'split-image',
  'subtitle-converter',
  'subtitle-shift',
  'timecode-calculator',
  'transcribe-audio',
  'trim-audio',
  'trim-video',
  'upscale-image',
  'vfr-to-cfr',
  'video-converter',
  'video-info',
  'video-speed',
  'video-to-gif',
  'watermark-image',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function hasView(id: string): id is ToolId {
  return (TOOL_IDS as readonly string[]).includes(id);
}
