'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.trimEngine, MEDIA_META.trim);

const OPTIONS: ShellOption[] = [
  {
    id: 'selection',
    label: 'Selection',
    choices: [
      { value: 'keep', label: 'Keep it' },
      { value: 'remove', label: 'Remove it' },
    ],
    default: 'keep',
  },
  {
    id: 'mode',
    label: 'Mode',
    choices: [
      { value: 'fast', label: 'Fast, no re-encode' },
      { value: 'precise', label: 'Precise' },
    ],
    default: 'fast',
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'mp4', label: 'MP4' },
      { value: 'webm', label: 'WebM' },
    ],
    default: 'keep',
    when: { id: 'mode', values: ['precise'] },
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to trim',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  probe: (file) => probeVideo(file),
  // Keep or remove several ranges; the parts join, the audio with a 10 ms crossfade.
  ranges: true,
  runLabel: 'Trim',
  // Fast keeps the file's own format; the engine reports it.
  outputExt: (options) =>
    options.mode === 'precise' && options.format !== 'keep' ? (options.format ?? '') : '',
  outputSuffix: 'trimmed',
  resultTitle: 'Trimmed',
};

/** V01 Trim Video (tools/video.md). */
export default function TrimVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
