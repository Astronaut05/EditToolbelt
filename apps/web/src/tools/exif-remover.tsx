'use client';

import { imageMetadataEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { IMAGE_FORMATS_LINE, IMAGE_INTAKE } from './image-presets';

const OPTIONS: ShellOption[] = [
  {
    id: 'remove',
    label: 'Remove',
    kind: 'select',
    choices: [
      { value: 'all', label: 'Everything' },
      { value: 'location', label: 'Location only' },
      { value: 'camera', label: 'All but camera and settings' },
      { value: 'none', label: 'Nothing, just look' },
    ],
    default: 'all',
  },
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  dropTitle: 'Drop a photo to see its metadata',
  chooseLabel: 'Choose photos',
  tapLabel: 'Choose photos',
  formats: IMAGE_FORMATS_LINE,
  formatsShort: 'JPG, PNG, WebP, HEIC',
  options: OPTIONS,
  autoRun: true,
  facts: (_state, options) => [
    {
      label: 'Always kept',
      value:
        options.remove === 'none'
          ? 'Everything: nothing is changed'
          : 'The orientation and the colour profile, so the photo looks the same',
    },
  ],
  runLabel: 'Remove metadata',
  outputExt: () => 'jpg',
  outputSuffix: 'clean',
  resultTitle: 'Metadata',
};

/** P15 Photo Metadata Viewer & Remover (tools/photo.md). */
export default function ExifRemover({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={imageMetadataEngine} onEvent={trackUnknown} />
  );
}
