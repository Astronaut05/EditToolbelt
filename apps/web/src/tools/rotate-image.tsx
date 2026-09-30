'use client';

import { imageGeometryEngine } from '@etb/engines';
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
  // A batch has no editor: one turn and flip for every image.
  {
    id: 'rotateAll',
    label: 'Rotate',
    files: 'many',
    choices: [
      { value: '0', label: 'None' },
      { value: '90', label: '90° right' },
      { value: '180', label: '180°' },
      { value: '270', label: '90° left' },
    ],
    default: '90',
  },
  {
    id: 'flipAll',
    label: 'Flip',
    files: 'many',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
    ],
    default: 'none',
  },
  // Straighten, in the editor: what happens to the corners.
  {
    id: 'angleFit',
    label: 'Corners',
    files: 'one',
    choices: [
      { value: 'crop', label: 'Auto-crop' },
      { value: 'expand', label: 'Expand canvas' },
    ],
    default: 'crop',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    files: 'one',
    choices: [
      { value: 'transparent', label: 'Transparent' },
      { value: 'white', label: 'White' },
      { value: 'black', label: 'Black' },
    ],
    default: 'transparent',
    when: { id: 'angleFit', values: ['expand'] },
  },
  // A 90° JPG is decoded and saved again, so the default is gentler than elsewhere (spec: 95).
  ...SAME_FORMAT_OPTIONS.map((option) =>
    option.id === 'quality' ? { ...option, default: '95' } : option,
  ),
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop an image to rotate',
  chooseLabel: 'Choose images',
  tapLabel: 'Choose images',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [
    ['rotateAll', 'flipAll'],
    ['angleFit', 'canvas'],
    ['format', 'quality'],
    ['metadata'],
  ],
  editor: {
    mode: 'straighten',
    modes: ['straighten', 'rotate-left', 'rotate', 'flip', 'flip-v'],
  },
  result: 'output',
  runLabel: 'Save image',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'rotated',
  resultTitle: 'Rotated',
};

/** P04 Rotate & Flip Image (tools/photo.md). */
export default function RotateImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
