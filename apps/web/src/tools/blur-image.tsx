'use client';

import { imageGeometryEngine } from '@etb/engines';
import { ToolShell, type FaceFinder, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { modelUrl } from '../lib/urls';
import { EXT, IMAGE_INTAKE, METADATA_OPTION, SAME_FORMAT_OPTIONS } from './image-presets';

const MODELS_BASE = modelUrl('');

/** Decodes the editor's image: an <img> may load a blob: URL, where fetch() isn't allowed (CSP). */
async function decoded(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

/** The face finder loads when "Find faces" is pressed, not with the page (docs/10). */
const findFaces: FaceFinder = async (src, signal, onProgress) => {
  const [{ findFaces: find }, photo] = await Promise.all([
    import('@etb/engines/find-faces'),
    decoded(src),
  ]);
  return find(photo, MODELS_BASE, signal, onProgress);
};

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  // One image at a time: the areas belong to it.
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop a photo to blur faces or plates in',
  chooseLabel: 'Choose a photo',
  tapLabel: 'Choose a photo',
  formats: (max) => `JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to ${max} and 100 MP`,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: [...SAME_FORMAT_OPTIONS, METADATA_OPTION],
  editor: { mode: 'blur', modes: ['blur'], findFaces },
  runLabel: 'Save image',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'blurred',
  resultTitle: 'Image saved',
};

/** P12 Blur & Pixelate (tools/photo.md). */
export default function BlurImage({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
