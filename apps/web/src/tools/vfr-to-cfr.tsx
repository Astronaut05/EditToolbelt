'use client';

import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const RATES = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];

const OPTIONS: ShellOption[] = [
  {
    id: 'fps',
    label: 'Frame rate',
    kind: 'select',
    choices: [
      { value: 'auto', label: 'Auto · nearest standard' },
      ...RATES.map((rate) => ({ value: rate, label: `${rate} fps` })),
    ],
    default: 'auto',
  },
  {
    id: 'quality',
    label: 'Quality',
    choices: [
      { value: 'best', label: 'Lossless look' },
      { value: 'high', label: 'High' },
      { value: 'small', label: 'Smaller' },
    ],
    default: 'best',
  },
  {
    id: 'audio',
    label: 'Audio',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'remove', label: 'Remove' },
    ],
    default: 'keep',
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  maxBytes: 2 * 1024 ** 3,
  formats: 'MP4, MOV, WebM, MKV · up to 2 GB free, 10 GB with credits',
  dropTitle: 'Drop a phone or screen recording',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [['fps'], ['quality', 'audio']],
  probe: async (file) => {
    const info = await probeVideo(file, false, true);
    // What the browser sees; our servers check the frames' timing again before anything runs.
    const verdict =
      info.frameRate === 'constant'
        ? `It looks constant already${info.fps ? ` (${String(info.fps)} fps)` : ''}. Our servers check again, and charge nothing if it is.`
        : undefined;
    return {
      ...info,
      warnings: verdict
        ? [verdict, ...(info.warnings ?? []).filter((line) => !line.startsWith('Variable'))]
        : info.warnings,
    };
  },
  facts: (state, options, media) =>
    media?.fps
      ? [
          {
            label: 'Frame rate',
            value: `${media.frameRate === 'variable' ? 'Variable, about ' : ''}${String(media.fps)} fps → ${options.fps === 'auto' ? 'nearest standard' : `${options.fps ?? ''} fps`}`,
          },
        ]
      : [],
  serverReason: 'Precise frame timing needs ffmpeg, so this tool runs on our servers.',
  runLabel: 'Convert',
  outputExt: () => 'mp4',
  outputSuffix: 'cfr',
  resultTitle: 'Constant frame rate',
};

const toServerOptions = (options: Record<string, string>) => ({
  fps: options.fps,
  quality: options.quality,
  audio: options.audio === 'remove' ? 'remove' : 'keep',
});

/** V15 VFR to CFR (tools/video.md): on our servers only, with ffmpeg. */
export default function VfrToCfr({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo(
    () =>
      info &&
      serverPath(
        tool.id,
        info,
        toServerOptions,
        typeof window === 'undefined' ? '/' : window.location.pathname,
      ),
    [info, tool.id],
  );
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
