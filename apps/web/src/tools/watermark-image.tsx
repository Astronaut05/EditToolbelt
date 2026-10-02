'use client';

import { watermarkEngine, type Engine, type WatermarkOptions } from '@etb/engines';
import {
  fileOptionFile,
  ToolShell,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import {
  EXT,
  IMAGE_FORMATS_LINE,
  IMAGE_INTAKE,
  METADATA_OPTION,
  SAME_FORMAT_OPTIONS,
} from './image-presets';

/** The shell's options as the engine takes them: the chosen logo as its file. */
const engine: Engine<Record<string, string>> = {
  capabilities: (caps) => watermarkEngine.capabilities(caps),
  estimate: (input) => watermarkEngine.estimate(input, {}),
  run: (file, options, ctx) => {
    const { logo, ...rest } = options;
    const chosen: WatermarkOptions = { ...rest, logo: fileOptionFile(logo ?? '') };
    return watermarkEngine.run(file, chosen, ctx);
  },
};

const placed = { id: 'tile', values: ['off'] };

const OPTIONS: ShellOption[] = [
  {
    id: 'kind',
    label: 'Watermark',
    choices: [
      { value: 'text', label: 'Text' },
      { value: 'logo', label: 'Logo' },
    ],
    default: 'text',
  },
  {
    id: 'text',
    label: 'Text',
    kind: 'text',
    placeholder: '© Your Name',
    default: '',
    when: { id: 'kind', values: ['text'] },
  },
  {
    id: 'color',
    label: 'Colour',
    kind: 'color',
    default: '#ffffff',
    when: { id: 'kind', values: ['text'] },
  },
  {
    id: 'logo',
    label: 'Logo',
    kind: 'file',
    accept: '.png,.webp,.jpg,.jpeg,image/png,image/webp,image/jpeg',
    default: '',
    when: { id: 'kind', values: ['logo'] },
  },
  {
    id: 'position',
    label: 'Position',
    kind: 'grid',
    choices: [
      { value: 'tl', label: 'Top left' },
      { value: 't', label: 'Top' },
      { value: 'tr', label: 'Top right' },
      { value: 'l', label: 'Left' },
      { value: 'c', label: 'Centre' },
      { value: 'r', label: 'Right' },
      { value: 'bl', label: 'Bottom left' },
      { value: 'b', label: 'Bottom' },
      { value: 'br', label: 'Bottom right' },
    ],
    default: 'br',
    when: placed,
  },
  {
    id: 'size',
    label: 'Size',
    kind: 'slider',
    min: 1,
    max: 100,
    unit: '%',
    default: '15',
  },
  {
    id: 'opacity',
    label: 'Opacity',
    kind: 'slider',
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
    default: '60',
  },
  {
    id: 'margin',
    label: 'Margin',
    kind: 'slider',
    min: 0,
    max: 25,
    unit: '%',
    default: '2',
    when: placed,
  },
  {
    id: 'offsetX',
    label: 'Offset right',
    kind: 'number',
    min: -50,
    max: 50,
    unit: '%',
    default: '0',
    when: placed,
  },
  {
    id: 'offsetY',
    label: 'Offset down',
    kind: 'number',
    min: -50,
    max: 50,
    unit: '%',
    default: '0',
    when: placed,
  },
  {
    id: 'tile',
    label: 'Tile',
    choices: [
      { value: 'off', label: 'Once' },
      { value: 'on', label: 'Tiled' },
    ],
    default: 'off',
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop photos to watermark',
  chooseLabel: 'Choose photos',
  tapLabel: 'Choose photos',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  facts: () => [
    {
      label: 'Sizes',
      value: '% of each photo’s width',
    },
  ],
  phoneGroups: [
    ['kind', 'text', 'color', 'logo'],
    ['position', 'size'],
    ['tile', 'opacity', 'margin'],
    ['offsetX', 'offsetY'],
    ['format', 'quality'],
    ['metadata'],
  ],
  blocked: (options) =>
    options.kind === 'logo'
      ? options.logo
        ? undefined
        : 'Choose a logo image.'
      : options.text?.trim()
        ? undefined
        : 'Type the watermark text.',
  // On one photo, a changed setting redoes it straight away, to compare.
  rerun: true,
  runLabel: 'Add watermark',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'watermarked',
  resultTitle: 'Watermark added',
};

/** P11 Watermark Images (tools/photo.md). */
export default function WatermarkImage({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
