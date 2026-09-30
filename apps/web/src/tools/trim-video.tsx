'use client';

import { trimEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
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
  runLabel: 'Trim',
  // Fast keeps the file's own format; the engine reports it.
  outputExt: (options) =>
    options.mode === 'precise' && options.format !== 'keep' ? (options.format ?? '') : '',
  outputSuffix: 'trimmed',
  resultTitle: 'Trimmed',
};

/** V01 Trim Video (tools/video.md). */
export default function TrimVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={trimEngine} onEvent={trackUnknown} />;
}
