import type { ShellOption, ShellPreset } from '@etb/ui';

/**
 * Shared bits of the photo tools' presets (tools/photo.md → shared rules):
 * inputs, limits, the metadata choice and the output formats we can write.
 */

export const IMAGE_ACCEPT = 'image/*,.heic,.heif,.avif';

export const IMAGE_INTAKE: Pick<
  ShellPreset,
  'noun' | 'accept' | 'multiple' | 'maxFiles' | 'sampleUrl' | 'sampleName' | 'camera'
> = {
  noun: 'image',
  accept: IMAGE_ACCEPT,
  multiple: true,
  maxFiles: 50,
  sampleUrl: '/samples/mug.jpg',
  sampleName: 'mug.jpg',
  camera: true,
};

export const IMAGE_FORMATS_LINE = (max: string) =>
  `JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to ${max} and 100 MP · up to 50 at once`;

export const LOSSY = ['jpeg', 'webp', 'avif'];

export const EXT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  bmp: 'bmp',
};

export const METADATA_OPTION: ShellOption = {
  id: 'metadata',
  label: 'Metadata',
  choices: [
    { value: 'keep', label: 'Camera, no GPS' },
    { value: 'none', label: 'Remove all' },
  ],
  default: 'keep',
};

/** Crop and Resize: keep the file's format unless another is picked; quality for lossy output. */
export const SAME_FORMAT_OPTIONS: ShellOption[] = [
  {
    id: 'format',
    label: 'Format',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'jpeg', label: 'JPG' },
      { value: 'png', label: 'PNG' },
      { value: 'webp', label: 'WebP' },
      { value: 'avif', label: 'AVIF' },
    ],
    default: 'keep',
  },
  {
    id: 'quality',
    label: 'Quality',
    kind: 'slider',
    min: 1,
    max: 100,
    default: '90',
    when: { id: 'format', values: ['keep', ...LOSSY] },
  },
];
