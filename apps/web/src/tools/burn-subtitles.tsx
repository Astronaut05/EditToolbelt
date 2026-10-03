'use client';

import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'subtitles',
    label: 'Subtitles',
    kind: 'file',
    accept: '.srt,.vtt,.ass,.ssa',
    default: '',
  },
  {
    id: 'font',
    label: 'Font',
    choices: [
      { value: 'sans', label: 'Sans' },
      { value: 'serif', label: 'Serif' },
      { value: 'mono', label: 'Mono' },
    ],
    default: 'sans',
  },
  {
    id: 'size',
    label: 'Size',
    choices: [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' },
    ],
    default: 'medium',
  },
  { id: 'color', label: 'Color', kind: 'color', default: '#ffffff' },
  {
    id: 'outline',
    label: 'Outline',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'thin', label: 'Thin' },
      { value: 'thick', label: 'Thick' },
    ],
    default: 'thin',
  },
  {
    id: 'box',
    label: 'Background box',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    default: 'off',
  },
  {
    id: 'position',
    label: 'Position',
    choices: [
      { value: 'bottom', label: 'Bottom' },
      { value: 'top', label: 'Top' },
    ],
    default: 'bottom',
  },
  {
    id: 'width',
    label: 'Line width',
    choices: [
      { value: 'full', label: 'Full' },
      { value: 'narrow', label: 'Narrow' },
    ],
    default: 'full',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  maxBytes: 2 * 1024 ** 3,
  formats: 'MP4, MOV, WebM, MKV · up to 2 GB free, 10 GB with credits',
  dropTitle: 'Drop the video',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [
    ['subtitles'],
    ['font', 'size', 'color'],
    ['outline', 'box'],
    ['position', 'width'],
  ],
  probe: (file) => probeVideo(file, false, true),
  blocked: (options) =>
    options.subtitles ? undefined : 'Choose the subtitle file: SRT, VTT or ASS.',
  serverReason:
    'Drawing text into every frame needs ffmpeg and our fonts, so this tool runs on our servers.',
  runLabel: 'Burn',
  outputExt: () => 'mp4',
  outputSuffix: 'subtitled',
  resultTitle: 'Subtitles burned in',
};

/** The same settings for our servers (@etb/registry/options → burn-subtitles). */
const toServerOptions = (options: Record<string, string>) => ({
  subtitles: options.subtitles,
  font: options.font,
  size: options.size,
  color: options.color,
  outline: options.outline,
  box: options.box === 'on',
  position: options.position,
  width: options.width,
});

const FILES = [{ option: 'subtitles', label: 'subtitle file' }] as const;

/** V16 Burn Subtitles into Video (tools/video.md): on our servers, with libass. */
export default function BurnSubtitles({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo(
    () =>
      info &&
      serverPath(
        tool.id,
        info,
        toServerOptions,
        typeof window === 'undefined' ? '/' : window.location.pathname,
        FILES,
      ),
    [info, tool.id],
  );
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
