'use client';

import { lutPreviewEngine, type Engine, type LutPreviewOptions } from '@etb/engines';
import {
  fileOptionFile,
  ToolShell,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { EXT, IMAGE_INTAKE, METADATA_OPTION, SAME_FORMAT_OPTIONS } from './image-presets';

/** The shell's options as the engine takes them: the chosen LUT as its file. */
const engine: Engine<Record<string, string>> = {
  capabilities: (caps) => lutPreviewEngine.capabilities(caps),
  estimate: (input) => lutPreviewEngine.estimate(input, {}),
  run: (file, options, ctx) => {
    const { lut, ...rest } = options;
    const chosen: LutPreviewOptions = { ...rest, lut: fileOptionFile(lut ?? '') };
    return lutPreviewEngine.run(file, chosen, ctx);
  },
};

const OPTIONS: ShellOption[] = [
  { id: 'lut', label: 'LUT', kind: 'file', accept: '.cube', default: '' },
  {
    id: 'intensity',
    label: 'Intensity',
    kind: 'slider',
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
    default: '100',
  },
  ...SAME_FORMAT_OPTIONS,
  METADATA_OPTION,
];

const PRESET: ShellPreset = {
  ...IMAGE_INTAKE,
  // One still at a time, to compare before and after.
  multiple: false,
  maxFiles: 1,
  dropTitle: 'Drop a still to try a LUT on',
  chooseLabel: 'Choose an image',
  tapLabel: 'Choose an image',
  formats: 'JPG, PNG, WebP, AVIF, TIFF, HEIC · up to 200 MB and 100 MP',
  formatsShort: 'JPG, PNG, WebP, AVIF, TIFF',
  options: OPTIONS,
  phoneGroups: [['lut', 'intensity'], ['format', 'quality'], ['metadata']],
  blocked: (options) => (options.lut ? undefined : 'Choose a .cube LUT.'),
  // A new intensity or LUT redoes the result, for comparing straight away.
  rerun: true,
  runLabel: 'Apply LUT',
  outputExt: (options) => EXT[options.format ?? ''] ?? '',
  outputSuffix: 'graded',
  resultTitle: 'LUT applied',
};

/** C05 LUT Preview on Image (tools/color.md). */
export default function LutPreview({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={engine} onEvent={trackUnknown} />;
}
