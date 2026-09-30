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

/** Sizes people ask for by name (tools/photo.md → P03 presets). */
const PRESETS = [
  { value: 'hd-1280x720', label: 'HD · 1280 × 720' },
  { value: 'fhd-1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '4k-3840x2160', label: '4K · 3840 × 2160' },
  { value: 'square-1080x1080', label: 'Instagram square · 1080 × 1080' },
  { value: 'story-1080x1920', label: 'Story · 1080 × 1920' },
  { value: 'thumb-1280x720', label: 'YouTube thumbnail · 1280 × 720' },
];

/** Modes that fill a box, where the fit matters. */
const BOXES = ['box', ...PRESETS.map((preset) => preset.value)];

const OPTIONS: ShellOption[] = [
  {
    id: 'by',
    label: 'Resize to',
    kind: 'select',
    choices: [
      { value: 'box', label: 'Width and height' },
      { value: 'width', label: 'Width' },
      { value: 'height', label: 'Height' },
      { value: 'percent', label: 'Percentage' },
      { value: 'longest', label: 'Longest side' },
      ...PRESETS,
    ],
    default: 'box',
  },
  {
    id: 'width',
    label: 'Width',
    kind: 'number',
    unit: 'px',
    min: 1,
    default: '1920',
    when: { id: 'by', values: ['box', 'width'] },
  },
  {
    id: 'height',
    label: 'Height',
    kind: 'number',
    unit: 'px',
    min: 1,
    default: '1080',
    when: { id: 'by', values: ['box', 'height'] },
  },
  {
    id: 'percent',
    label: 'Percentage',
    kind: 'number',
    unit: '%',
    min: 1,
    max: 1000,
    default: '50',
    when: { id: 'by', values: ['percent'] },
  },
  {
    id: 'longest',
    label: 'Longest side',
    kind: 'number',
    unit: 'px',
    min: 1,
    default: '2048',
    when: { id: 'by', values: ['longest'] },
  },
  {
    id: 'fit',
    label: 'Fit',
    choices: [
      { value: 'keep', label: 'Keep ratio' },
      { value: 'pad', label: 'Pad' },
      { value: 'fill', label: 'Fill' },
      { value: 'stretch', label: 'Stretch' },
    ],
    default: 'keep',
    when: { id: 'by', values: BOXES },
  },
  {
    id: 'pad',
    label: 'Padding',
    choices: [
      { value: 'white', label: 'White' },
      { value: 'black', label: 'Black' },
      { value: 'transparent', label: 'None' },
    ],
    default: 'white',
    when: { id: 'fit', values: ['pad'] },
  },
  {
    id: 'filter',
    label: 'Resampling',
    kind: 'select',
    choices: [
      { value: 'lanczos', label: 'Lanczos · sharpest' },
      { value: 'bicubic', label: 'Bicubic' },
      { value: 'bilinear', label: 'Bilinear · softer' },
      { value: 'nearest', label: 'Nearest · pixel art' },
    ],
    default: 'lanczos',
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop images to resize',
  chooseLabel: 'Choose images',
  tapLabel: 'Choose images',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [
    ['by', 'width', 'height', 'percent', 'longest'],
    ['fit', 'pad'],
    ['filter'],
    ['format', 'quality'],
    ['metadata'],
  ],
  result: 'output',
  runLabel: 'Resize',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'resized',
  resultTitle: 'Resized',
};

/** P03 Resize Image (tools/photo.md). */
export default function ResizeImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
