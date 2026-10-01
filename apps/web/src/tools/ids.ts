/**
 * Ids of the tools that have a view in src/tools. A plain module, so server
 * code can read it (exports of the 'use client' map are client references).
 * The map in ./index.tsx is typed against this list, so the two can't drift.
 */
export const TOOL_IDS = [
  'aspect-ratio-calculator',
  'audio-converter',
  'bitrate-calculator',
  'bpm-key-finder',
  'color-converter',
  'color-palette-from-image',
  'color-picker-from-image',
  'compress-image',
  'compress-video',
  'crop-image',
  'extract-audio',
  'gif-to-mp4',
  'image-converter',
  'mute-video',
  'qr-code-generator',
  'remove-background',
  'resize-image',
  'rotate-image',
  'subtitle-converter',
  'subtitle-shift',
  'timecode-calculator',
  'trim-audio',
  'trim-video',
  'vfr-to-cfr',
  'video-converter',
  'video-info',
  'video-to-gif',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function hasView(id: string): id is ToolId {
  return (TOOL_IDS as readonly string[]).includes(id);
}
