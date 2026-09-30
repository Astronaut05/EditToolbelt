'use client';

import { videoInfoEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { VIDEO_INTAKE } from './video-presets';

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
  return <ToolShell tool={tool} preset={PRESET} engine={videoInfoEngine} onEvent={trackUnknown} />;
}
