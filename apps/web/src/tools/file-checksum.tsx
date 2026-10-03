'use client';

import { checksum } from '@etb/core';
import { fileChecksumEngine } from '@etb/engines';
import {
  ToolShell,
  type BatchResult,
  type BatchVerdict,
  type ShellOption,
  type ShellPreset,
  type ShellTool,
} from '@etb/ui';

import { trackUnknown } from '../lib/analytics';

const { HASH_ALGOS, HASH_LABEL, checkFile, checksumList, parseExpected } = checksum;
type HashAlgo = checksum.HashAlgo;

const OPTIONS: ShellOption[] = [
  {
    id: 'expected',
    label: 'Expected hash',
    kind: 'textarea',
    placeholder: 'Paste a hash, or a SHA256SUMS or MD5 list',
    default: '',
  },
  {
    id: 'list',
    label: 'List format',
    kind: 'select',
    choices: [
      { value: 'sha256', label: 'SHA256SUMS' },
      { value: 'md5', label: 'MD5SUMS' },
      { value: 'sha1', label: 'SHA1SUMS' },
      { value: 'csv', label: 'CSV, all three' },
    ],
    default: 'sha256',
  },
];

/** A result's three hashes, from the engine's details. */
function hashesOf(item: BatchResult): Partial<Record<HashAlgo, string>> {
  const hashes: Partial<Record<HashAlgo, string>> = {};
  for (const algo of HASH_ALGOS) {
    const fact = item.facts.find((f) => f.label === HASH_LABEL[algo]);
    if (fact) hashes[algo] = fact.value;
  }
  return hashes;
}

const checkOf = (item: BatchResult, options: Record<string, string>) =>
  checkFile(item.name, hashesOf(item), parseExpected(options.expected ?? ''));

function verdict(item: BatchResult, options: Record<string, string>): BatchVerdict | null {
  const check = checkOf(item, options);
  if (check.kind === 'match') return { note: `Matches the ${HASH_LABEL[check.algo]} pasted` };
  if (check.kind === 'mismatch') {
    return {
      problem: `Doesn’t match the ${HASH_LABEL[check.algo]} pasted (${check.expected.slice(0, 12)}…)`,
    };
  }
  if (check.kind === 'missing') return { note: 'Not in the pasted list' };
  return null;
}

/** One line over the finished files: the pasted hashes checked, or copies compared. */
function summary(items: BatchResult[], options: Record<string, string>): string | null {
  if (items.length === 0) return null;
  const checks = items.map((item) => checkOf(item, options));
  const matched = checks.filter((c) => c.kind === 'match').length;
  const mismatched = checks.filter((c) => c.kind === 'mismatch').length;
  const missing = checks.filter((c) => c.kind === 'missing').length;
  if (matched + mismatched > 0) {
    if (items.length === 1) {
      return mismatched
        ? 'The hash doesn’t match: this file differs from the one that was hashed.'
        : 'The hash matches: this is the same file.';
    }
    const notListed = missing ? ` ${String(missing)} not in the list.` : '';
    return mismatched
      ? `${String(mismatched)} of ${String(matched + mismatched)} files don’t match.${notListed}`
      : `All ${String(matched)} files checked match.${notListed}`;
  }
  if (items.length < 2) return null;
  const distinct = new Set(items.map((item) => hashesOf(item).sha256)).size;
  if (distinct === 1) {
    return items.length === 2
      ? 'The 2 files are identical.'
      : `All ${String(items.length)} files are identical.`;
  }
  if (distinct === items.length) {
    return items.length === 2 ? 'The 2 files are different.' : null;
  }
  const copies = items.length - distinct;
  return `${String(copies)} ${copies === 1 ? 'file is a copy' : 'files are copies'} of another file here.`;
}

const format = (options: Record<string, string>): HashAlgo | 'csv' =>
  options.list === 'csv' || HASH_ALGOS.includes(options.list as HashAlgo)
    ? (options.list as HashAlgo | 'csv')
    : 'sha256';

const PRESET: ShellPreset = {
  noun: 'file',
  accept: '',
  multiple: true,
  maxFiles: 1000,
  dropTitle: 'Drop files to hash',
  chooseLabel: 'Choose files',
  tapLabel: 'Choose files',
  formats: (max) => `Any files · up to ${max} each`,
  options: OPTIONS,
  autoRun: true,
  runLabel: 'Hash',
  outputExt: () => 'sha256',
  outputSuffix: '',
  resultTitle: 'Hashed',
  batchCheck: verdict,
  batchSummary: summary,
  batchList: {
    label: (options) => {
      const f = format(options);
      return `Download list · ${f === 'csv' ? 'CSV' : HASH_LABEL[f]}`;
    },
    make: (items, options) =>
      checksumList(
        items.map((item) => ({ name: item.name, size: item.size, hashes: hashesOf(item) })),
        format(options),
      ),
  },
};

/** U04 File Checksum (tools/utility.md). */
export default function FileChecksum({ tool }: { tool: ShellTool }) {
  return (
    <ToolShell tool={tool} preset={PRESET} engine={fileChecksumEngine} onEvent={trackUnknown} />
  );
}
