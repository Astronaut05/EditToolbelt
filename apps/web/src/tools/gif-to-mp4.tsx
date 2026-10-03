'use client';

import { MEDIA_META, readGif } from '@etb/engines';
import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.gifToVideoEngine, MEDIA_META.gifToVideo);

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'mp4', label: 'MP4' },
      { value: 'webm', label: 'WebM' },
    ],
    default: 'mp4',
  },
  {
    id: 'plays',
    label: 'Plays',
    kind: 'select',
    choices: [
      { value: '1', label: 'Once' },
      { value: '2', label: '2 times' },
      { value: '3', label: '3 times' },
      { value: '5', label: '5 times' },
      { value: '10', label: '10 times' },
    ],
    default: '1',
  },
  { id: 'background', label: 'Background', kind: 'color', default: '#ffffff' },
];

/** Reads the GIF as it arrives: size, frames and length. */
async function probe(file: File): Promise<ProbeInfo> {
  const gif = readGif(new Uint8Array(await file.arrayBuffer()));
  const frames = gif.frames.length;
  return {
    durationSec: gif.durationMs / 1000,
    width: gif.width,
    height: gif.height,
    summary: `${String(gif.width)} × ${String(gif.height)} px · ${String(frames)} frame${frames === 1 ? '' : 's'} · ${(gif.durationMs / 1000).toFixed(2)} s`,
    warnings:
      frames === 1
        ? ['This GIF has one frame: the video will be a still, as long as its delay (or 0.1 s).']
        : [],
  };
}

const PRESET: ShellPreset = {
  noun: 'image',
  accept: 'image/gif,.gif',
  dropTitle: 'Drop a GIF here',
  chooseLabel: 'Choose a GIF',
  tapLabel: 'Choose a GIF',
  formats: (max) => `Animated GIF · up to ${max}`,
  formatsShort: 'Animated GIF',
  options: OPTIONS,
  phoneGroups: [['format', 'plays'], ['background']],
  probe,
  runLabel: 'Convert',
  // H.264 falls back to WebM where the browser has no encoder; the engine reports it.
  outputExt: (options) => options.format ?? 'mp4',
  outputSuffix: '',
  resultTitle: 'Converted',
};

/** V05 GIF to MP4 (tools/video.md). */
export default function GifToMp4({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
