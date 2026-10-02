'use client';

import { imageGeometryEngine } from '@etb/engines';
import { ToolShell, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { EXT, IMAGE_INTAKE, METADATA_OPTION, SAME_FORMAT_OPTIONS } from './image-presets';

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  // One image at a time: the marks belong to it.
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop an image to draw on',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: 'JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to 200 MB and 100 MP',
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: [
    // A screenshot stays a PNG unless another format is picked.
    ...SAME_FORMAT_OPTIONS,
    METADATA_OPTION,
  ],
  editor: { mode: 'draw', modes: ['draw'] },
  runLabel: 'Save image',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'annotated',
  resultTitle: 'Image saved',
};

/** P09 Draw on Image (tools/photo.md). */
export default function DrawOnImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
