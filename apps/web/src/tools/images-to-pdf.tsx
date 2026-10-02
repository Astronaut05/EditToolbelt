'use client';

import { imagesToPdfEngine } from '@etb/engines';
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

const KIND: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/avif': 'AVIF',
  'image/bmp': 'BMP',
  'image/heic': 'HEIC',
};

/** Each image's size, read as it's added, so the list says what it holds. */
async function describe(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('this browser can’t read it.');
  });
  const summary = `${String(bitmap.width)} × ${String(bitmap.height)} px · ${KIND[file.type] ?? 'Image'}`;
  bitmap.close();
  return { summary };
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
