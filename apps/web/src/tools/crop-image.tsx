'use client';

import { imageGeometryEngine, ratioValue } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import {
  EXT,
  IMAGE_FORMATS_LINE,
  IMAGE_INTAKE,
  METADATA_OPTION,
  SAME_FORMAT_OPTIONS,
} from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'ratio',
    label: 'Ratio',
    kind: 'select',
    choices: [
      { value: 'free', label: 'Free' },
      { value: '1:1', label: '1:1 · Square' },
      { value: '4:5', label: '4:5 · Portrait post' },
      { value: '16:9', label: '16:9 · Widescreen' },
      { value: '9:16', label: '9:16 · Story, Reel' },
      { value: '4:3', label: '4:3' },
      { value: '3:2', label: '3:2 · Camera' },
      { value: '2:3', label: '2:3' },
      { value: '21:9', label: '21:9 · Cinema' },
      { value: 'custom', label: 'Custom' },
    ],
    default: 'free',
  },
  {
    id: 'ratioW',
    label: 'Ratio width',
    kind: 'number',
    min: 1,
    default: '5',
    when: { id: 'ratio', values: ['custom'] },
  },
  {
    id: 'ratioH',
    label: 'Ratio height',
    kind: 'number',
    min: 1,
    default: '7',
    when: { id: 'ratio', values: ['custom'] },
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const ratioOf = (options: Record<string, string>) =>
  ratioValue(options.ratio, options.ratioW, options.ratioH);

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop an image to crop',
  chooseLabel: 'Choose images',
  tapLabel: 'Choose images',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [['ratio', 'ratioW', 'ratioH'], ['format', 'quality'], ['metadata']],
  editor: { mode: 'crop', modes: ['crop', 'rotate'], ratio: ratioOf },
  result: 'output',
  // A batch has no box to drag: each image is cropped to the ratio, centered.
  blocked: (options, files) =>
    files > 1 && ratioOf(options) === null
      ? 'Pick a ratio to crop several images: each one is cropped to it, centered.'
      : undefined,
  runLabel: 'Crop image',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'cropped',
  resultTitle: 'Cropped',
};

/** P02 Crop Image (tools/photo.md). */
export default function CropImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
