'use client';

import type { ShellTool } from '@etb/ui';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

import { hasView, type ToolId } from './ids';

/** `to` presets the output format on conversion pair pages (/convert/srt-to-vtt). */
type View = ComponentType<{ tool: ShellTool; to?: string }>;

/**
 * The client component behind each working tool, by registry id. Each one is
 * its own chunk: it is prerendered with the page and loaded only by the page
 * that shows it, so hubs and other tools don't pay for it (docs/10 → Budgets).
 * Every `live` or `beta` tool needs an entry here and in ./ids.ts
 * (checked in lib/tool.test.ts).
 */
const VIEWS: Readonly<Record<ToolId, View>> = {
  'aspect-ratio-calculator': dynamic(() => import('./aspect-ratio-calculator')),
  'audio-channels': dynamic(() => import('./audio-channels')),
  'audio-converter': dynamic(() => import('./audio-converter')),
  'batch-rename': dynamic(() => import('./batch-rename')),
  'bitrate-calculator': dynamic(() => import('./bitrate-calculator')),
  'bpm-key-finder': dynamic(() => import('./bpm-key-finder')),
  'change-pitch': dynamic(() => import('./change-pitch')),
  'burn-subtitles': dynamic(() => import('./burn-subtitles')),
  'color-converter': dynamic(() => import('./color-converter')),
  'color-palette-from-image': dynamic(() => import('./color-palette-from-image')),
  'color-picker-from-image': dynamic(() => import('./color-picker-from-image')),
  'compress-image': dynamic(() => import('./compress-image')),
  'compress-video': dynamic(() => import('./compress-video')),
  'contrast-checker': dynamic(() => import('./contrast-checker')),
  'crop-image': dynamic(() => import('./crop-image')),
  'dpi-calculator': dynamic(() => import('./dpi-calculator')),
  'draw-on-image': dynamic(() => import('./draw-on-image')),
  'exif-remover': dynamic(() => import('./exif-remover')),
  'extract-audio': dynamic(() => import('./extract-audio')),
  'extract-frames': dynamic(() => import('./extract-frames')),
  'fade-audio': dynamic(() => import('./fade-audio')),
  'gif-to-mp4': dynamic(() => import('./gif-to-mp4')),
  'image-converter': dynamic(() => import('./image-converter')),
  'loudness-meter': dynamic(() => import('./loudness-meter')),
  'lut-preview': dynamic(() => import('./lut-preview')),
  'merge-audio': dynamic(() => import('./merge-audio')),
  'merge-videos': dynamic(() => import('./merge-videos')),
  'mute-video': dynamic(() => import('./mute-video')),
  'normalize-audio': dynamic(() => import('./normalize-audio')),
  'qr-code-generator': dynamic(() => import('./qr-code-generator')),
  'remove-background': dynamic(() => import('./remove-background')),
  'remove-silence': dynamic(() => import('./remove-silence')),
  'replace-audio': dynamic(() => import('./replace-audio')),
  'resize-image': dynamic(() => import('./resize-image')),
  'resize-video': dynamic(() => import('./resize-video')),
  'rotate-image': dynamic(() => import('./rotate-image')),
  'rotate-video': dynamic(() => import('./rotate-video')),
  'social-media-image-resizer': dynamic(() => import('./social-media-image-resizer')),
  'split-image': dynamic(() => import('./split-image')),
  'subtitle-converter': dynamic(() => import('./subtitle-converter')),
  'subtitle-shift': dynamic(() => import('./subtitle-shift')),
  'timecode-calculator': dynamic(() => import('./timecode-calculator')),
  'trim-audio': dynamic(() => import('./trim-audio')),
  'trim-video': dynamic(() => import('./trim-video')),
  'vfr-to-cfr': dynamic(() => import('./vfr-to-cfr')),
  'video-converter': dynamic(() => import('./video-converter')),
  'video-info': dynamic(() => import('./video-info')),
  'video-speed': dynamic(() => import('./video-speed')),
  'video-to-gif': dynamic(() => import('./video-to-gif')),
  'watermark-image': dynamic(() => import('./watermark-image')),
};

export function ToolView({ tool, to }: { tool: ShellTool; to?: string }) {
  if (!hasView(tool.id)) throw new Error(`${tool.id} is working but has no view in src/tools`);
  const View = VIEWS[tool.id];
  return <View tool={tool} to={to} />;
}
