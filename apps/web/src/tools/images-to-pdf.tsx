'use client';

import { IMAGE_FORMAT_LABELS, imageHeader, imagesToPdfEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { IMAGE_ACCEPT } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'size',
    label: 'Page size',
    choices: [
      { value: 'a4', label: 'A4' },
      { value: 'letter', label: 'Letter' },
      { value: 'fit', label: 'Fit image' },
    ],
    default: 'a4',
  },
  {
    id: 'orientation',
    label: 'Orientation',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    default: 'auto',
    when: { id: 'size', values: ['a4', 'letter'] },
  },
  {
    id: 'margin',
    label: 'Margins',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'small', label: '10 mm' },
      { value: 'large', label: '20 mm' },
    ],
    default: 'small',
  },
];

/**
 * Each image's size and format, read from its header as it's added, so the
 * list says what it holds; one over the limits is marked before anything
 * decodes it.
 */
async function describe(file: File) {
  const { format, width, height } = await imageHeader(file);
  const kind = IMAGE_FORMAT_LABELS[format];
  return {
    summary: width === null ? kind : `${String(width)} × ${String(height)} px · ${kind}`,
  };
}

const PRESET: ShellPreset = {
  noun: 'image',
  accept: IMAGE_ACCEPT,
  maxBytes: 200 * 1024 * 1024,
  dropTitle: 'Drop images to make a PDF',
  chooseLabel: 'Choose images',
  tapLabel: 'Choose images',
  formats: 'JPG, PNG, WebP, GIF, AVIF · 1 to 100 images',
  formatsShort: 'JPG, PNG, WebP, GIF, AVIF',
  options: OPTIONS,
  phoneGroups: [['size', 'orientation'], ['margin']],
  combine: { min: 1, max: 100, describe },
  runLabel: 'Make PDF',
  outputExt: () => 'pdf',
  outputSuffix: '',
  resultTitle: 'PDF made',
};

/** P18 Images to PDF (tools/photo.md). */
export default function ImagesToPdf({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imagesToPdfEngine} onEvent={trackUnknown} />
  );
}
