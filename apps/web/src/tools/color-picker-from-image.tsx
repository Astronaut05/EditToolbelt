'use client';

import { pickedColorsEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const OPTIONS: ShellOption[] = [
  {
    id: 'sample',
    label: 'Sample',
    choices: [
      { value: '1', label: '1 px' },
      { value: '3', label: '3 × 3' },
      { value: '5', label: '5 × 5' },
    ],
    default: '1',
  },
  {
    id: 'zoom',
    label: 'Loupe',
    choices: [
      { value: '4', label: '4×' },
      { value: '8', label: '8×' },
      { value: '16', label: '16×' },
    ],
    default: '8',
  },
  {
    id: 'export',
    label: 'Save picks as',
    kind: 'select',
    choices: [
      { value: 'css', label: 'CSS variables' },
      { value: 'json', label: 'JSON' },
      { value: 'ase', label: 'ASE · Adobe swatches' },
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
  phoneGroups: [['sample', 'zoom'], ['export']],
  // The picker is the workspace; every pick updates the file of picked colours.
  autoRun: true,
  picker: { history: 'picked', sample: 'sample', zoom: 'zoom' },
  runLabel: 'Save picks',
  outputExt: (options) => options.export ?? 'css',
  outputSuffix: 'colors',
  resultTitle: 'Pick colors',
};

/** C02 Color Picker from Image (tools/color.md). */
export default function ColorPickerFromImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={pickedColorsEngine} onEvent={trackUnknown} />
  );
}
