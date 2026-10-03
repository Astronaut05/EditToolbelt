'use client';

import { imageToSvgEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { IMAGE_ACCEPT } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'mode',
    label: 'Mode',
    choices: [
      { value: 'color', label: 'Colour' },
      { value: 'bw', label: 'Black and white' },
    ],
    default: 'color',
  },
  {
    id: 'colors',
    label: 'Colours',
    kind: 'slider',
    min: 2,
    max: 16,
    default: '6',
    when: { id: 'mode', values: ['color'] },
  },
  {
    id: 'detail',
    label: 'Detail',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    default: 'medium',
  },
  {
    id: 'smoothness',
    label: 'Edges',
    choices: [
      { value: 'smooth', label: 'Smooth' },
      { value: 'sharp', label: 'Sharp' },
      { value: 'pixels', label: 'Pixels' },
    ],
    default: 'smooth',
  },
];

const PRESET: ShellPreset = {
  noun: 'image',
  accept: IMAGE_ACCEPT,
  dropTitle: 'Drop a logo or illustration',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: (max) => `PNG, JPG, WebP, GIF, AVIF, BMP · up to ${max}`,
  formatsShort: 'PNG, JPG, WebP, GIF, AVIF',
  options: OPTIONS,
  phoneGroups: [
    ['mode', 'colors'],
    ['detail', 'smoothness'],
  ],
  // A changed setting traces it again, to compare straight away.
  rerun: true,
  runLabel: 'Make SVG',
  outputExt: () => 'svg',
  outputSuffix: '',
  resultTitle: 'SVG ready',
};

/** P19 Image to SVG (tools/photo.md). */
export default function ImageToSvg({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={imageToSvgEngine} onEvent={trackUnknown} />;
}
