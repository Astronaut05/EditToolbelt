'use client';

import { MEDIA_META } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { mediaEngine } from './media-engine';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

// The engine loads with its first run, not with the page (docs/10).
const engine = mediaEngine((m) => m.videoSpeedEngine, MEDIA_META.videoSpeed);

const OPTIONS: ShellOption[] = [
  {
    id: 'speed',
    label: 'Speed',
    kind: 'select',
    choices: [
      ...['0.25', '0.5', '0.75', '1.25', '1.5', '2', '3', '4'].map((s) => ({
        value: s,
        label: `${s}×${Number(s) < 1 ? ', slower' : ', faster'}`,
      })),
      { value: 'custom', label: 'Custom' },
    ],
    default: '2',
  },
  {
    id: 'customSpeed',
    label: 'Custom speed',
    kind: 'number',
    unit: '×',
    min: 0.25,
    max: 4,
    step: 0.05,
    default: '1.1',
    when: { id: 'speed', values: ['custom'] },
  },
  {
    id: 'audio',
    label: 'Sound',
    choices: [
      { value: 'keep', label: 'Keep pitch' },
      { value: 'shift', label: 'Shift pitch' },
      { value: 'mute', label: 'Mute' },
    ],
    default: 'keep',
  },
  {
    id: 'frames',
    label: 'Frames',
    choices: [
      { value: 'retime', label: 'Keep every frame' },
      { value: 'reencode', label: 'Keep frame rate' },
    ],
    default: 'retime',
  },
];

const speedOf = (options: Record<string, string>) =>
  Number(options.speed === 'custom' ? options.customSpeed : options.speed);

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  dropTitle: 'Drop a video to speed up or slow down',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['speed', 'customSpeed'],
    ['audio', 'frames'],
  ],
  probe: (file) => probeVideo(file),
  facts: (_state, options, media) => {
    const speed = speedOf(options);
    if (!media || !(speed > 0)) return [];
    const fps = media.fps ?? 30;
    const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    return [
      {
        label: 'Length',
        value: `${media.durationSec.toFixed(1)} s → ${(media.durationSec / speed).toFixed(1)} s`,
      },
      {
        label: 'Frame rate',
        value:
          options.frames === 'reencode'
            ? `${round(fps)} fps, re-encoded`
            : `${round(fps)} → ${round(fps * speed)} fps, copied as it is`,
      },
    ];
  },
  blocked: (options) => {
    const speed = speedOf(options);
    if (!(speed >= 0.25 && speed <= 4)) return 'Set a speed from 0.25× to 4×.';
    return speed === 1 ? 'Set a speed other than 1×.' : undefined;
  },
  runLabel: 'Change speed',
  // The video keeps its own format; the engine reports it.
  outputExt: () => '',
  outputSuffix: 'speed',
  resultTitle: 'Speed changed',
};

/** V13 Change Video Speed (tools/video.md). */
export default function VideoSpeed({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
