'use client';

import {
  MASK_MODES,
  parseStrokes,
  ToolShell,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';
import { useMemo } from 'react';

import { trackUnknown } from '../lib/analytics';
import { serverPath } from '../lib/server-run';
import { marksSomething, renderMask } from './object-eraser-mask';

/** Where the page keeps the brush strokes (JSON, image px) between the brush and the run. */
const STROKES = 'strokes';

const OPTIONS: ShellOption[] = [
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

/** The picture's size as shown, read in the browser: the brush works in its pixels. */
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
  dropTitle: 'Drop a photo',
  chooseLabel: 'Choose a photo',
  tapLabel: 'Choose a photo',
  formats: 'PNG, JPG, WebP · up to 25 MB free, 100 MB with credits',
  formatsShort: 'PNG, JPG, WebP',
  options: OPTIONS,
  phoneGroups: [['format']],
  probe,
  mask: { option: STROKES },
  blocked: (options) =>
    marksSomething(parseStrokes(options[STROKES], MASK_MODES))
      ? undefined
      : 'Brush over what to remove first.',
  facts: (_state, options) => [
    { label: 'AI model', value: 'MI-GAN · fills each area from the photo around it' },
    {
      label: 'Untouched pixels',
      value: options.format === 'png' ? 'Kept exactly' : 'Saved again at high quality',
    },
  ],
  serverReason: 'The AI model needs a GPU, so this tool runs on our servers.',
  runLabel: 'Erase',
  outputExt: (options) => options.format ?? 'png',
  outputSuffix: 'erased',
  resultTitle: 'Erased',
};

/** The same settings for our servers (@etb/registry/options → object-eraser). */
const toServerOptions = (options: Record<string, string>) => ({
  mask: options.mask,
  format: options.format,
});

/** The mask goes up as its own upload, drawn from the strokes at the photo's shape. */
const MASK = [
  {
    option: 'mask',
    label: 'mask',
    make: async (file: File, options: Record<string, string>) => {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      return renderMask(parseStrokes(options[STROKES], MASK_MODES), width, height);
    },
  },
] as const;

/** P17 Object Eraser (tools/photo.md): brush over an object, MI-GAN fills it on our GPU servers. */
export default function ObjectEraser({ tool }: { tool: ShellTool }) {
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
        { derived: MASK },
      ),
    [info, tool.id],
  );
  return <ToolShell tool={tool} preset={PRESET} onEvent={trackUnknown} server={server} />;
}
