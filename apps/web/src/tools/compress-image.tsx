'use client';

import { imageCodecEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { EXT, IMAGE_FORMATS_LINE, IMAGE_INTAKE, METADATA_OPTION } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Compress by',
    choices: [
      { value: 'quality', label: 'Quality' },
      { value: 'target', label: 'Target size' },
    ],
    default: 'quality',
  },
  {
    id: 'quality',
    label: 'Quality',
    kind: 'slider',
    min: 1,
    max: 100,
    default: '75',
    when: { id: 'mode', values: ['quality'] },
  },
  {
    id: 'targetKb',
    label: 'Target size',
    kind: 'number',
    unit: 'KB',
    min: 10,
    step: 10,
    default: '500',
    when: { id: 'mode', values: ['target'] },
  },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'jpeg', label: 'JPG' },
      { value: 'webp', label: 'WebP' },
      { value: 'avif', label: 'AVIF' },
      { value: 'png', label: 'PNG' },
    ],
    default: 'keep',
  },
  {
    id: 'maxSide',
    label: 'Longest side',
    choices: [
      { value: '0', label: 'Keep' },
      { value: '3840', label: '3840' },
      { value: '2560', label: '2560' },
      { value: '1920', label: '1920' },
      { value: '1280', label: '1280' },
    ],
    default: '0',
  },
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop images to compress',
  chooseLabel: 'Choose images',
  tapLabel: 'Choose images',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [['mode', 'quality', 'targetKb'], ['format', 'maxSide'], ['metadata']],
  runLabel: 'Compress',
  // "Keep" depends on the file: the engine reports the real format after the run.
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'compressed',
  resultTitle: 'Compressed',
};

/** P05 Compress Image (tools/photo.md). */
export default function CompressImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell
      tool={tool}
      preset={PRESET}
      engine={imageCodecEngine}
      engineOptions={{ neverGrow: true }}
      onEvent={trackUnknown}
    />
  );
}
