'use client';

import { imageGeometryEngine } from '@etb/engines';
import { ToolShell, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { EXT, IMAGE_INTAKE, METADATA_OPTION, SAME_FORMAT_OPTIONS } from './image-presets';

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  // One image at a time: the text belongs to it.
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop an image to add text to',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: (max) => `JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to ${max} and 100 MP`,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: [
    // A screenshot stays a PNG unless another format is picked.
    ...SAME_FORMAT_OPTIONS,
    METADATA_OPTION,
  ],
  editor: { mode: 'text', modes: ['text'] },
  runLabel: 'Save image',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'text',
  resultTitle: 'Image saved',
};

/** P10 Add Text to Image (tools/photo.md). */
export default function AddTextToImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
