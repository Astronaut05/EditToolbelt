'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.videoInfoEngine, MEDIA_META.videoInfo);

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Export as',
    choices: [
      { value: 'txt', label: 'Text' },
      { value: 'json', label: 'JSON' },
    ],
    default: 'txt',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  // Only the headers and packet table are read, so the file can be as big as it likes.
  maxBytes: 2 * 1024 ** 3,
  dropTitle: 'Drop a video to inspect',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  autoRun: true,
  outputExt: (options) => (options.format === 'json' ? 'json' : 'txt'),
  outputSuffix: 'info',
  resultTitle: 'Video info',
  preview: 'text',
};

/** V08 Video Info & VFR Check (tools/video.md). */
export default function VideoInfo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
