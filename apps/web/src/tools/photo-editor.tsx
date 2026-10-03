'use client';

import { imageGeometryEngine, ratioValue } from '@etb/engines';
import {
  ToolShell,
  type FaceFinder,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

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

/** Blur mode's face finder loads when "Find faces" is pressed, not with the page (docs/10). */
const findFaces: FaceFinder = async (src, signal, onProgress) => {
  const [{ findFaces: find }, photo] = await Promise.all([
    import('@etb/engines/find-faces'),
    decoded(src),
  ]);
  return find(photo, MODELS_BASE, signal, onProgress);
};

const OPTIONS: ShellOption[] = [
  {
    id: 'ratio',
    label: 'Crop ratio',
    kind: 'select',
    choices: [
      { value: 'free', label: 'Free' },
      { value: '1:1', label: '1:1 · Square' },
      { value: '4:5', label: '4:5 · Portrait post' },
      { value: '16:9', label: '16:9 · Widescreen' },
      { value: '9:16', label: '9:16 · Story, Reel' },
      { value: '4:3', label: '4:3' },
      { value: '3:2', label: '3:2 · Camera' },
      { value: '2:3', label: '2:3' },
    ],
    default: 'free',
  },
  {
    id: 'by',
    label: 'Size',
    choices: [
      { value: 'original', label: 'Original' },
      { value: 'longest', label: 'Longest side' },
      { value: 'percent', label: 'Percentage' },
    ],
    default: 'original',
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
    id: 'percent',
    label: 'Percentage',
    kind: 'number',
    unit: '%',
    min: 1,
    max: 400,
    default: '50',
    when: { id: 'by', values: ['percent'] },
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  // One photo at a time: the edits belong to it.
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop a photo to edit',
  chooseLabel: 'Choose a photo',
  tapLabel: 'Choose a photo',
  formats: (max) => `JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to ${max} and 100 MP`,
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [['ratio'], ['by', 'longest', 'percent'], ['format', 'quality'], ['metadata']],
  editor: {
    mode: 'adjust',
    modes: [
      'crop',
      'straighten',
      'rotate-left',
      'rotate',
      'flip',
      'flip-v',
      'adjust',
      'draw',
      'text',
      'blur',
    ],
    ratio: (options) => ratioValue(options.ratio),
    findFaces,
    layout: 'rail',
  },
  runLabel: 'Save image',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'edited',
  resultTitle: 'Image saved',
};

/** P01 Photo Editor (tools/photo.md). */
export default function PhotoEditor({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageGeometryEngine} onEvent={trackUnknown} />
  );
}
