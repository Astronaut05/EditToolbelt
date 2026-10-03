'use client';

import { paletteEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const OPTIONS: ShellOption[] = [
  {
    id: 'count',
    label: 'Colors',
    kind: 'select',
    choices: [3, 4, 5, 6, 8, 10, 12].map((n) => ({ value: String(n), label: String(n) })),
    default: '6',
  },
  {
    id: 'method',
    label: 'Kind',
    choices: [
      { value: 'dominant', label: 'Dominant' },
      { value: 'vibrant', label: 'Vibrant' },
      { value: 'muted', label: 'Muted' },
    ],
    default: 'dominant',
  },
  {
    id: 'extremes',
    label: 'White and black',
    choices: [
      { value: 'on', label: 'Leave out' },
      { value: 'off', label: 'Include' },
    ],
    default: 'on',
  },
  {
    id: 'export',
    label: 'Download as',
    kind: 'select',
    choices: [
      { value: 'css', label: 'CSS variables' },
      { value: 'json', label: 'JSON' },
      { value: 'ase', label: 'ASE · Adobe swatches' },
      { value: 'png', label: 'PNG palette card' },
    ],
    default: 'css',
  },
];

const PRESET: ShellPreset = {
  noun: 'image',
  accept: 'image/*,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp',
  sampleUrl: '/samples/mug.jpg',
  sampleName: 'mug.jpg',
  dropTitle: 'Drop an image here',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: (max) => `JPG, PNG, WebP, AVIF, GIF · up to ${max}`,
  formatsShort: 'JPG, PNG, WebP, AVIF',
  options: OPTIONS,
  phoneGroups: [['count', 'method'], ['extremes'], ['export']],
  // The palette shows as soon as the image is in; a change of setting runs it again.
  autoRun: true,
  runLabel: 'Find colors',
  outputExt: (options) => options.export ?? 'css',
  outputSuffix: 'palette',
  resultTitle: 'Palette',
};

/** C01 Color Palette from Image (tools/color.md). */
export default function ColorPaletteFromImage({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={paletteEngine} onEvent={trackUnknown} />;
}
