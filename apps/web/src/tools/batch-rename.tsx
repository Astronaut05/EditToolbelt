'use client';

import { DATE_FORMATS } from '@etb/core/rename';
import { batchRenameEngine, renamePlan } from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const where = (id: string, values: string[], label: string): ShellOption => ({
  id,
  label,
  choices: [
    { value: 'start', label: 'Start' },
    { value: 'end', label: 'End' },
    { value: 'replace', label: 'Instead' },
  ],
  default: id === 'counterWhere' ? 'end' : 'start',
  when: { id: id === 'counterWhere' ? 'counter' : 'date', values },
});

const OPTIONS: ShellOption[] = [
  { id: 'find', label: 'Find', kind: 'text', placeholder: 'IMG_', default: '' },
  { id: 'replaceWith', label: 'Replace with', kind: 'text', default: '' },
  {
    id: 'match',
    label: 'Match',
    choices: [
      { value: 'text', label: 'Text' },
      { value: 'case', label: 'Exact case' },
      { value: 'regex', label: 'Pattern' },
    ],
    default: 'text',
  },
  {
    id: 'remove',
    label: 'Remove',
    kind: 'checklist',
    choices: [
      { value: 'spaces', label: 'Spaces' },
      { value: 'digits', label: 'Digits' },
      { value: 'special', label: 'Symbols', detail: '# ! & …' },
      { value: 'brackets', label: 'Brackets and what’s in them', detail: '(1) [old]' },
    ],
    default: '',
  },
  {
    id: 'case',
    label: 'Case',
    kind: 'select',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'lower', label: 'lower case' },
      { value: 'upper', label: 'UPPER CASE' },
      { value: 'title', label: 'Title Case' },
      { value: 'sentence', label: 'Sentence case' },
      { value: 'kebab', label: 'kebab-case' },
      { value: 'snake', label: 'snake_case' },
    ],
    default: 'keep',
  },
  { id: 'prefix', label: 'Prefix', kind: 'text', default: '' },
  { id: 'suffix', label: 'Suffix', kind: 'text', default: '' },
  {
    id: 'date',
    label: 'Date',
    kind: 'select',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'taken', label: 'Date taken' },
      { value: 'modified', label: 'Date modified' },
      { value: 'today', label: 'Today' },
    ],
    default: 'none',
  },
  {
    id: 'dateFormat',
    label: 'Date format',
    kind: 'select',
    choices: DATE_FORMATS.map((format) => ({ value: format, label: format })),
    default: 'YYYY-MM-DD',
    when: { id: 'date', values: ['taken', 'modified', 'today'] },
  },
  where('dateWhere', ['taken', 'modified', 'today'], 'Date goes'),
  {
    id: 'counter',
    label: 'Counter',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    default: 'off',
  },
  {
    id: 'counterStart',
    label: 'Start at',
    kind: 'number',
    min: 0,
    max: 999999,
    default: '1',
    when: { id: 'counter', values: ['on'] },
  },
  {
    id: 'counterStep',
    label: 'Step',
    kind: 'number',
    min: 1,
    max: 1000,
    default: '1',
    when: { id: 'counter', values: ['on'] },
  },
  {
    id: 'counterPad',
    label: 'Digits',
    kind: 'number',
    min: 1,
    max: 8,
    default: '3',
    when: { id: 'counter', values: ['on'] },
  },
  where('counterWhere', ['on'], 'Counter goes'),
  {
    id: 'sortBy',
    label: 'Count in order of',
    kind: 'select',
    choices: [
      { value: 'added', label: 'As added' },
      { value: 'name', label: 'Name' },
      { value: 'taken', label: 'Date taken' },
      { value: 'modified', label: 'Date modified' },
    ],
    default: 'added',
    when: { id: 'counter', values: ['on'] },
  },
  { id: 'separator', label: 'Separator', kind: 'text', placeholder: '_', default: '_' },
  { id: 'extension', label: 'New extension', kind: 'text', placeholder: 'Keep', default: '' },
  {
    id: 'extensionCase',
    label: 'Extension case',
    choices: [
      { value: 'keep', label: 'Keep' },
      { value: 'lower', label: 'lower' },
      { value: 'upper', label: 'UPPER' },
    ],
    default: 'keep',
  },
];

const PRESET: ShellPreset = {
  noun: 'file',
  accept: '',
  multiple: true,
  maxFiles: 1000,
  maxBytes: 4 * 1024 * 1024 * 1024,
  dropTitle: 'Drop files to rename',
  chooseLabel: 'Choose files',
  tapLabel: 'Choose files',
  formats: 'Any files · up to 1,000 at once',
  options: OPTIONS,
  phoneGroups: [
    ['find', 'replaceWith', 'match'],
    ['remove', 'case'],
    ['prefix', 'suffix', 'separator'],
    ['date', 'dateFormat', 'dateWhere'],
    ['counter', 'counterStart', 'counterStep', 'counterPad', 'counterWhere', 'sortBy'],
    ['extension', 'extensionCase'],
  ],
  names: { plan: renamePlan, inPlace: true },
  runLabel: 'Rename',
  outputExt: () => '',
  outputSuffix: '',
  resultTitle: 'Renamed',
};

/** U02 Batch Rename Files (tools/utility.md). */
export default function BatchRename({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={batchRenameEngine} onEvent={trackUnknown} />
  );
}
