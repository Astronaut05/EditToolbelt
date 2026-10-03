'use client';

import { collageEngine, COLLAGE_SIZES, imageHeader, IMAGE_FORMAT_LABELS } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { IMAGE_ACCEPT } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'template',
    label: 'Layout',
    kind: 'select',
    choices: [
      { value: 'grid', label: 'Grid' },
      { value: 'feature', label: 'Big left' },
      { value: 'feature-top', label: 'Big top' },
      { value: 'columns', label: 'Columns' },
      { value: 'rows', label: 'Rows' },
    ],
    default: 'grid',
  },
  {
    id: 'size',
    label: 'Output size',
    kind: 'select',
    choices: Object.entries(COLLAGE_SIZES).map(([value, size]) => ({
      value,
      label: `${size.label} · ${String(size.width)} × ${String(size.height)} px`,
    })),
    default: 'square',
  },
  { id: 'spacing', label: 'Spacing', kind: 'slider', min: 0, max: 120, unit: 'px', default: '24' },
  {
    id: 'radius',
    label: 'Corner radius',
    kind: 'slider',
    min: 0,
    max: 120,
    unit: 'px',
    default: '0',
  },
  { id: 'background', label: 'Background', kind: 'color', default: '#ffffff' },
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'jpeg', label: 'JPG' },
      { value: 'png', label: 'PNG' },
      { value: 'webp', label: 'WebP' },
    ],
    default: 'jpeg',
  },
];

const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/**
 * Each photo's size, read from its header as it's added, so the list says
 * what it holds; one over the limits is marked before anything decodes it.
 */
async function describe(file: File) {
  const { format, width, height } = await imageHeader(file);
  return {
    summary:
      width === null ? IMAGE_FORMAT_LABELS[format] : `${String(width)} × ${String(height)} px`,
  };
}

const PRESET: ShellPreset = {
  noun: 'image',
  accept: IMAGE_ACCEPT,
  dropTitle: 'Drop 2 to 9 photos for a collage',
  chooseLabel: 'Choose photos',
  tapLabel: 'Choose photos',
  formats: 'JPG, PNG, WebP, GIF, AVIF · 2 to 9 photos',
  formatsShort: 'JPG, PNG, WebP, GIF, AVIF',
  options: OPTIONS,
  phoneGroups: [['template', 'size'], ['spacing', 'radius', 'background'], ['format']],
  combine: { min: 2, max: 9, describe },
  runLabel: 'Make collage',
  outputExt: (values) => EXT[values.format ?? 'jpeg'] ?? 'jpg',
  outputSuffix: 'collage',
  result: 'output',
  resultTitle: 'Collage made',
};

/** P16 Collage Maker (tools/photo.md). */
export default function CollageMaker({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={collageEngine} onEvent={trackUnknown} />;
}
