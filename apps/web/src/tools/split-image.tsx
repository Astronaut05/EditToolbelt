'use client';

import { imageSplitEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { IMAGE_INTAKE, METADATA_OPTION, SAME_FORMAT_OPTIONS } from './image-presets';

const COUNTS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const OPTIONS: ShellOption[] = [
  {
    id: 'grid',
    label: 'Grid',
    kind: 'select',
    choices: [
      { value: '3x3', label: '3 × 3 profile grid' },
      { value: '1x2', label: '1 × 2 carousel' },
      { value: '1x3', label: '1 × 3 panorama' },
      { value: '1x4', label: '1 × 4 panorama' },
      { value: '1x10', label: '1 × 10 carousel' },
      { value: '2x2', label: '2 × 2' },
      { value: '2x3', label: '2 × 3' },
      { value: '3x2', label: '3 × 2' },
      { value: 'custom', label: 'Custom' },
    ],
    default: '3x3',
  },
  {
    id: 'rows',
    label: 'Rows',
    kind: 'select',
    choices: COUNTS,
    default: '2',
    when: { id: 'grid', values: ['custom'] },
  },
  {
    id: 'cols',
    label: 'Columns',
    kind: 'select',
    choices: COUNTS,
    default: '2',
    when: { id: 'grid', values: ['custom'] },
  },
  {
    id: 'gap',
    label: 'Gaps',
    choices: [
      { value: '0', label: 'None' },
      { value: '0.025', label: 'Feed gaps' },
    ],
    default: '0',
  },
  {
    id: 'remainder',
    label: 'Tiles',
    choices: [
      { value: 'equal', label: 'Equal size' },
      { value: 'spread', label: 'Every pixel' },
    ],
    default: 'equal',
  },
  {
    id: 'order',
    label: 'Numbering',
    choices: [
      { value: 'rows', label: 'Row by row' },
      { value: 'posting', label: 'Posting order' },
    ],
    default: 'rows',
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop an image to split',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: (max) => `JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to ${max} and 100 MP`,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [
    ['grid', 'rows', 'cols'],
    ['gap', 'remainder', 'order'],
    ['format', 'quality'],
    ['metadata'],
  ],
  facts: (_state, options) => [
    {
      label: 'Gaps',
      value:
        options.gap === '0'
          ? 'Tiles meet edge to edge'
          : 'A thin strip left out between tiles, so the picture lines up across a feed',
    },
  ],
  runLabel: 'Split image',
  outputExt: () => 'zip',
  outputSuffix: 'grid',
  resultTitle: 'Split into tiles',
};

/** P14 Split Image into Grid (tools/photo.md): one image, a ZIP of tiles. */
export default function SplitImage({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={imageSplitEngine} onEvent={trackUnknown} />;
}
