'use client';

import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { upscaleVideoFacts } from './gpu-video';
import { probeVideo, VIDEO_INTAKE } from './video-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'scale',
    label: 'Scale',
    choices: [
      { value: '2', label: '2×' },
      { value: '4', label: '4×' },
    ],
    default: '2',
  },
  {
    id: 'model',
    label: 'Model',
    choices: [
      { value: 'general', label: 'General' },
      { value: 'anime', label: 'Animation' },
    ],
    default: 'general',
  },
  {
    id: 'denoise',
    label: 'Noise cleanup',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    default: 'medium',
    when: { id: 'model', values: ['general'] },
  },
];

const PRESET: ShellPreset = {
  ...VIDEO_INTAKE,
  maxBytes: 2 * 1024 ** 3,
  formats: 'MP4, MOV, WebM, MKV · 1 min and 200 MB free, 10 min and 2 GB with credits',
  dropTitle: 'Drop a video to upscale',
  chooseLabel: 'Choose a video',
  tapLabel: 'Choose a video',
  options: OPTIONS,
  phoneGroups: [['scale', 'model'], ['denoise']],
  probe: (file) => probeVideo(file, false, true),
  facts: (_state, options, media) => upscaleVideoFacts(options, media),
  serverReason: 'The AI model runs on every frame on a GPU, so this tool runs on our servers.',
  runLabel: 'Upscale',
  outputExt: () => 'mp4',
  outputSuffix: 'upscaled',
  resultTitle: 'Upscaled',
};

/** The same settings for our servers (@etb/registry/options → upscale-video). */
const toServerOptions = (options: Record<string, string>) => ({
  scale: options.scale,
  model: options.model,
  denoise: options.denoise,
});

/** V20 Upscale Video (tools/video.md): Real-ESRGAN on every frame, on our GPU servers. */
export default function UpscaleVideo({ tool }: { tool: ShellTool }) {
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
