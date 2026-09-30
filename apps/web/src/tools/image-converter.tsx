'use client';

import { imageCodecEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { EXT, IMAGE_FORMATS_LINE, IMAGE_INTAKE, LOSSY, METADATA_OPTION } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Convert to',
    choices: [
      { value: 'jpeg', label: 'JPG' },
      { value: 'png', label: 'PNG' },
      { value: 'webp', label: 'WebP' },
      { value: 'avif', label: 'AVIF' },
      { value: 'bmp', label: 'BMP' },
    ],
    default: 'jpeg',
  },
  {
    id: 'quality',
    label: 'Quality',
    kind: 'slider',
    min: 1,
    max: 100,
    default: '85',
    when: { id: 'format', values: LOSSY },
  },
  {
    id: 'background',
    label: 'Transparency',
    choices: [
      { value: 'white', label: 'White' },
      { value: 'black', label: 'Black' },
    ],
    default: 'white',
    when: { id: 'format', values: ['jpeg'] },
  },
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop images here',
  chooseLabel: 'Choose images',
  tapLabel: 'Choose images',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [['format', 'quality'], ['background', 'metadata']],
  runLabel: 'Convert',
  outputExt: (options) => EXT[options.format ?? 'jpeg'] ?? 'jpg',
  outputSuffix: '',
  resultTitle: 'Converted',
};

/** Pair pages preset the target: /convert/png-to-jpg → "jpeg". */
const TARGET: Record<string, string> = { jpg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' };

/** P06 Image Converter (tools/photo.md). */
export default function ImageConverter({ tool, to }: { tool: ShellTool; to?: string }) {
  const initialOptions = Object.fromEntries(
    OPTIONS.map((option) => [
      option.id,
      option.id === 'format' && to && TARGET[to] ? TARGET[to] : option.default,
    ]),
  );
  return (
    <ToolShell
      tool={tool}
      preset={PRESET}
      engine={imageCodecEngine}
      initialOptions={initialOptions}
      onEvent={trackUnknown}
    />
  );
}
