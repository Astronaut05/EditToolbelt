'use client';

import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { backgroundFacts } from './gpu-video';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'output',
    label: 'Output',
    kind: 'select',
    choices: [
      { value: 'prores', label: 'ProRes 4444 · transparent' },
      { value: 'webm', label: 'WebM · transparent' },
      { value: 'green', label: 'Green screen · MP4' },
      { value: 'color', label: 'Color · MP4' },
    ],
    default: 'prores',
  },
  {
    id: 'color',
    label: 'Color',
    kind: 'color',
    default: '#ffffff',
    when: { id: 'output', values: ['color'] },
  },
];

const EXTENSIONS: Record<string, string> = { prores: 'mov', webm: 'webm' };

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  maxBytes: 2 * 1024 ** 3,
  formats: 'MP4, MOV, WebM, MKV · 1 min and 200 MB free, 10 min and 2 GB with credits',
  dropTitle: 'Drop a video',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [['output', 'color']],
  probe: (file) => probeVideo(file, false, true),
  facts: (_state, options, media) => backgroundFacts(options, media),
  serverReason:
    'The AI model finds the subject in every frame on a GPU, so this tool runs on our servers.',
  runLabel: 'Remove background',
  outputExt: (options) => EXTENSIONS[options.output ?? 'prores'] ?? 'mp4',
  outputSuffix: 'nobg',
  resultTitle: 'Background removed',
};

/** The same settings for our servers (@etb/registry/options → video-background-remover). */
const toServerOptions = (options: Record<string, string>) => ({
  output: options.output,
  color: options.color,
});

/** V21 Video Background Remover (tools/video.md): BiRefNet on every frame, on our GPU servers. */
export default function VideoBackgroundRemover({ tool }: { tool: ShellTool }) {
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
