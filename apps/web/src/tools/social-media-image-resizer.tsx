'use client';

import { PLATFORM_NAMES, SOCIAL_PRESETS, socialPresetsOf } from '@etb/core';
import { socialResizeEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { EXT, IMAGE_INTAKE, METADATA_OPTION, SAME_FORMAT_OPTIONS } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'sizes',
    label: 'Sizes',
    kind: 'checklist',
    choices: SOCIAL_PRESETS.map((preset) => ({
      value: preset.id,
      label: preset.name,
      group: PLATFORM_NAMES[preset.platform],
      detail: `${String(preset.width)} × ${String(preset.height)}`,
    })),
    default: 'instagram-portrait',
  },
  {
    id: 'fit',
    label: 'Fit',
    choices: [
      { value: 'fill', label: 'Fill, crop' },
      { value: 'blur', label: 'Fit on blur' },
      { value: 'color', label: 'Fit on color' },
    ],
    default: 'fill',
  },
  {
    id: 'color',
    label: 'Color',
    kind: 'color',
    default: '#ffffff',
    when: { id: 'fit', values: ['color'] },
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const sizesOf = (options: Record<string, string>) => socialPresetsOf(options.sizes);

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop an image to resize for social media',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: 'JPG, PNG, WebP, AVIF, GIF, BMP, HEIC · up to 200 MB and 100 MP',
  formatsShort: 'JPG, PNG, WebP, AVIF, HEIC',
  options: OPTIONS,
  phoneGroups: [['sizes'], ['fit', 'color'], ['format', 'quality'], ['metadata']],
  focus: {
    option: 'focus',
    frames: (options) =>
      sizesOf(options).map((preset) => ({
        label: preset.id,
        width: preset.width,
        height: preset.height,
      })),
    when: (options) => (options.fit ?? 'fill') === 'fill',
  },
  facts: (_state, options) => {
    const count = sizesOf(options).length;
    return [
      {
        label: 'Output',
        value:
          count === 0
            ? 'Pick at least one size'
            : count === 1
              ? 'One image at the exact size'
              : `${String(count)} images in a ZIP, each at its exact size`,
      },
    ];
  },
  blocked: (options) => (sizesOf(options).length === 0 ? 'Pick at least one size.' : undefined),
  result: 'output',
  runLabel: 'Resize image',
  outputExt: (options) => (sizesOf(options).length > 1 ? 'zip' : (EXT[options.format ?? ''] ?? '')),
  outputSuffix: 'social',
  resultTitle: 'Resized',
};

/** P13 Social Media Image Resizer (tools/photo.md): one image, every platform size. */
export default function SocialMediaImageResizer({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={socialResizeEngine} onEvent={trackUnknown} />
  );
}
