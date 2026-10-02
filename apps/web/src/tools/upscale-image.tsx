'use client';

import {
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';

/** The result is capped here (tools/photo.md → P08); the server refuses bigger before charging. */
const MAX_OUTPUT_MP = 64;

const OPTIONS: ShellOption[] = [
  {
    id: 'scale',
    label: 'Scale',
    choices: [
      { value: '2', label: '2×' },
      { value: '4', label: '4×' },
    ],
    default: '4',
  },
  {
    id: 'model',
    label: 'Model',
    choices: [
      { value: 'general', label: 'General' },
      { value: 'anime', label: 'Illustration' },
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
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'png', label: 'PNG' },
      { value: 'jpg', label: 'JPG' },
      { value: 'webp', label: 'WebP' },
    ],
    default: 'png',
  },
];

const factor = (options: Record<string, string>) => (options.scale === '2' ? 2 : 4);

/** The picture's size, read in the browser: the price and the 64 MP cap depend on it. */
async function probe(file: File): Promise<ProbeInfo> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  return { durationSec: 0, width, height, summary: `${String(width)} × ${String(height)} px` };
}

const PRESET: ShellPreset = {
  noun: 'image',
  accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
  maxBytes: 100 * 1024 ** 2,
  dropTitle: 'Drop an image to upscale',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: 'PNG, JPG, WebP · up to 25 MB free, 100 MB with credits',
  formatsShort: 'PNG, JPG, WebP',
  options: OPTIONS,
  phoneGroups: [['scale', 'model'], ['denoise'], ['format']],
  probe,
  facts: (_state, options, media) => {
    if (!media?.width || !media.height) return [];
    const width = media.width * factor(options);
    const height = media.height * factor(options);
    const megapixels = (width * height) / 1e6;
    return [
      {
        label: 'Result',
        value:
          megapixels > MAX_OUTPUT_MP
            ? `${String(width)} × ${String(height)} px, over the ${String(MAX_OUTPUT_MP)} MP limit: pick 2× or a smaller image`
            : `${String(width)} × ${String(height)} px · ${megapixels.toFixed(1)} MP`,
      },
    ];
  },
  serverReason: 'The AI model needs a GPU, so this tool runs on our servers.',
  runLabel: 'Upscale',
  outputExt: (options) => options.format ?? 'png',
  outputSuffix: 'upscaled',
  resultTitle: 'Upscaled',
};

/** The same settings for our servers (@etb/registry/options → upscale-image). */
const toServerOptions = (options: Record<string, string>) => ({
  scale: options.scale,
  model: options.model,
  denoise: options.denoise,
  format: options.format,
});

/** P08 Upscale Image (tools/photo.md): Real-ESRGAN on our GPU servers. */
export default function UpscaleImage({ tool }: { tool: ShellTool }) {
  const info = tool.server;
  const server = useMemo(
    () =>
      info &&
      serverPath(
        tool.id,
        info,
        toServerOptions,
        typeof window === 'undefined' ? '/' : window.location.pathname,
        [],
        // Priced per megapixel of the result (docs/05 → CreditRule).
        { megapixels: (width, height, options) => (width * height * factor(options) ** 2) / 1e6 },
      ),
    [info, tool.id],
  );
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
