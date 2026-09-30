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
  'audio-converter': dynamic(() => import('./audio-converter')),
  'bitrate-calculator': dynamic(() => import('./bitrate-calculator')),
  'bpm-key-finder': dynamic(() => import('./bpm-key-finder')),
  'color-converter': dynamic(() => import('./color-converter')),
  'color-palette-from-image': dynamic(() => import('./color-palette-from-image')),
  'color-picker-from-image': dynamic(() => import('./color-picker-from-image')),
  'compress-image': dynamic(() => import('./compress-image')),
  'compress-video': dynamic(() => import('./compress-video')),
  'crop-image': dynamic(() => import('./crop-image')),
  'extract-audio': dynamic(() => import('./extract-audio')),
  'gif-to-mp4': dynamic(() => import('./gif-to-mp4')),
  'image-converter': dynamic(() => import('./image-converter')),
  'mute-video': dynamic(() => import('./mute-video')),
  'qr-code-generator': dynamic(() => import('./qr-code-generator')),
  'remove-background': dynamic(() => import('./remove-background')),
  'resize-image': dynamic(() => import('./resize-image')),
  'rotate-image': dynamic(() => import('./rotate-image')),
  'subtitle-converter': dynamic(() => import('./subtitle-converter')),
  'subtitle-shift': dynamic(() => import('./subtitle-shift')),
  'timecode-calculator': dynamic(() => import('./timecode-calculator')),
  'trim-audio': dynamic(() => import('./trim-audio')),
  'trim-video': dynamic(() => import('./trim-video')),
  'video-converter': dynamic(() => import('./video-converter')),
  'video-info': dynamic(() => import('./video-info')),
  'video-to-gif': dynamic(() => import('./video-to-gif')),
};

export function ToolView({ tool, to }: { tool: ShellTool; to?: string }) {
  if (!hasView(tool.id)) throw new Error(`${tool.id} is working but has no view in src/tools`);
  const View = VIEWS[tool.id];
  return <View tool={tool} to={to} />;
}
