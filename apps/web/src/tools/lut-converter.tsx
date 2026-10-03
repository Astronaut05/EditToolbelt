'use client';

import { lutConvertEngine } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const OPTIONS: ShellOption[] = [
  {
    id: 'to',
    label: 'Convert to',
    choices: [
      { value: '3dl', label: '.3dl' },
      { value: 'cube', label: '.cube' },
    ],
    default: '3dl',
  },
  {
    id: 'grid',
    label: 'Grid',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: '17', label: '17' },
      { value: '33', label: '33' },
      { value: '65', label: '65' },
    ],
    default: 'keep',
  },
  {
    id: 'shape',
    label: 'Type',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: '3d', label: '3D cube' },
      { value: '1d', label: '1D curves' },
    ],
    default: 'keep',
  },
];

const PRESET: ShellPreset = {
  noun: 'file',
  accept: '.cube,.3dl',
  dropTitle: 'Drop a LUT to convert',
  chooseLabel: 'Choose a LUT',
  tapLabel: 'Choose a LUT file',
  formats: (max) => `.cube or .3dl, 1D or 3D · up to ${max}`,
  formatsShort: '.cube, .3dl',
  options: OPTIONS,
  phoneGroups: [['to'], ['grid', 'shape']],
  runLabel: 'Convert',
  outputExt: (options) => (options.to === 'cube' ? 'cube' : '3dl'),
  outputSuffix: '',
  resultTitle: 'Converted',
};

/** C06 LUT Converter (tools/color.md). */
export default function LutConverter({ tool }: { tool: ShellTool }) {
  return <ToolShell tool={tool} preset={PRESET} engine={lutConvertEngine} onEvent={trackUnknown} />;
}
