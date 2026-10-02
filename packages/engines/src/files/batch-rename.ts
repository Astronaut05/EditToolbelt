/**
 * U02 Batch Rename Files (tools/utility.md): the new names (`renamePlan`,
 * for the list shown before anything is written) and the run, which hands
 * back each file's own bytes under its new name. The rules are in
 * @etb/core/rename; when a photo or clip was taken is read once per file.
 */
import {
  blocking,
  DATE_FORMATS,
  DEFAULT_RULES,
  planRenames,
  PROBLEM_TEXT,
  RenameError,
  splitName,
  type CaseChange,
  type DateFormat,
  type DateSource,
  type Remove,
  type RenameRules,
  type SortBy,
  type Where,
} from '@etb/core/rename';

import type { Engine, EngineOutput } from '../types';
import { takenDate } from './taken';

/** Each file's new name, what's wrong with it, and whether that stops the rename. */
export interface NamedFile {
  to: string;
  problem?: string;
  blocks?: boolean;
}

export interface NamesPlan {
  /** In the files' own order. */
  names: NamedFile[];
  /** The rules themselves can't be used (a pattern that doesn't parse). */
  error?: string;
}

export class RenameInputError extends Error {}

const TAKEN = new WeakMap<Blob, Promise<Date | undefined>>();

function takenOf(file: Blob): Promise<Date | undefined> {
  let date = TAKEN.get(file);
  if (!date) {
    date = takenDate(file);
    TAKEN.set(file, date);
  }
  return date;
}

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T) =>
  allowed.includes(value as T) ? (value as T) : fallback;

const whole = (value: string | undefined, min: number, max: number, fallback: number) => {
  const number = Math.round(Number(value));
  return value !== undefined && value !== '' && Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};

const WHERE: readonly Where[] = ['start', 'end', 'replace'];

/** The page's options as rules. */
export function rulesFrom(options: Record<string, string>): RenameRules {
  const match = options.match ?? 'text';
  return {
    find: options.find ?? '',
    replaceWith: options.replaceWith ?? '',
    regex: match === 'regex',
    matchCase: match !== 'text',
    remove: (options.remove ?? '')
      .split(',')
      .filter((what): what is Remove =>
        (['spaces', 'digits', 'special', 'brackets'] as const).includes(what as Remove),
      ),
    case: oneOf<CaseChange>(
      options.case,
      ['keep', 'lower', 'upper', 'title', 'sentence', 'kebab', 'snake'],
      'keep',
    ),
    prefix: options.prefix ?? '',
    suffix: options.suffix ?? '',
    date: oneOf<DateSource>(options.date, ['none', 'today', 'taken', 'modified'], 'none'),
    dateFormat: oneOf<DateFormat>(options.dateFormat, DATE_FORMATS, DEFAULT_RULES.dateFormat),
    dateWhere: oneOf(options.dateWhere, WHERE, DEFAULT_RULES.dateWhere),
    counter: options.counter === 'on',
    counterStart: whole(options.counterStart, 0, 999_999, DEFAULT_RULES.counterStart),
    counterStep: whole(options.counterStep, 1, 1000, DEFAULT_RULES.counterStep),
    counterPad: whole(options.counterPad, 1, 8, DEFAULT_RULES.counterPad),
    counterWhere: oneOf(options.counterWhere, WHERE, DEFAULT_RULES.counterWhere),
    separator: options.separator ?? DEFAULT_RULES.separator,
    extension: (options.extension ?? '').trim(),
    extensionCase: oneOf(options.extensionCase, ['keep', 'lower', 'upper'] as const, 'keep'),
    sortBy: oneOf<SortBy>(options.sortBy, ['added', 'name', 'taken', 'modified'], 'added'),
  };
}

/** Every file's new name, from the options; dates taken are read only when a rule needs them. */
export async function renamePlan(
  files: readonly File[],
  options: Record<string, string>,
  today = new Date(),
): Promise<NamesPlan> {
  const rules = rulesFrom(options);
  const dated = rules.date === 'taken' || (rules.counter && rules.sortBy === 'taken');
  const taken = dated ? await Promise.all(files.map(takenOf)) : [];
  try {
    const planned = planRenames(
      files.map((file, i) => ({
        name: file.name,
        modified: new Date(file.lastModified),
        taken: taken[i],
      })),
      rules,
      today,
    );
    const names: NamedFile[] = files.map((file) => ({ to: file.name }));
    for (const plan of planned) {
      names[plan.index] = {
        to: plan.to,
        ...(plan.problems.length > 0 && {
          problem: plan.problems.map((problem) => PROBLEM_TEXT[problem]).join('. '),
          blocks: plan.problems.some(blocking),
        }),
      };
    }
    return { names };
  } catch (error) {
    if (error instanceof RenameError) {
      return { names: files.map((file) => ({ to: file.name })), error: error.message };
    }
    throw error;
  }
}

/** One plan per run: the files and options it was made for, so 1,000 files are named once. */
let last: { files: readonly File[]; key: string; plan: Promise<NamesPlan> } | null = null;

function planFor(files: readonly File[], options: Record<string, string>): Promise<NamesPlan> {
  const key = JSON.stringify(options);
  if (last?.files !== files || last.key !== key) {
    last = { files, key, plan: renamePlan(files, options) };
  }
  return last.plan;
}

export const batchRenameEngine: Engine<Record<string, string>> = {
  capabilities: () => ({ supported: true }),
  estimate: () => ({ seconds: 0.1 }),
  async run(input, options, ctx): Promise<EngineOutput> {
    const files = ctx.batch?.files ?? [input as File];
    const plan = await planFor(files, options);
    if (plan.error) throw new RenameInputError(plan.error);
    const named = plan.names[ctx.batch?.index ?? 0];
    if (!named || named.blocks) {
      throw new RenameInputError(named?.problem ?? 'This file has no new name.');
    }
    ctx.progress(1);
    return { blob: input, ext: splitName(named.to)[1], name: named.to, path: 'Browser' };
  },
};
