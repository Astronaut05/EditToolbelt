'use client';

import { muteVideoEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Mute',
    choices: [
      { value: 'all', label: 'All the audio' },
      { value: 'range', label: 'The selection' },
    ],
    default: 'all',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to mute',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  probe: (file) => probeVideo(file),
  runLabel: 'Mute',
  // The file keeps its own format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'muted',
  resultTitle: 'Muted',
};

/** V07 Mute Video (tools/video.md). The timeline picks the range for "The selection". */
export default function MuteVideo({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={muteVideoEngine} onEvent={trackUnknown} />;
}
