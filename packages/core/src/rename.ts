/**
 * U02 Batch Rename Files (tools/utility.md): new names from rules, applied
 * in a fixed order to each name's stem (the part before the extension):
 * find and replace, remove, case, prefix and suffix, date, counter, then the
 * extension. Pure, so the preview table, the ZIP and the in-place rename all
 * use the same names. Names that would clash, or that a disk won't take, are
 * flagged before anything is written.
 */

export interface RenameFile {
  name: string;
  /** When the photo or clip was taken (EXIF), if known. */
  taken?: Date;
  /** The file's last-modified time. */
  modified: Date;
}

export type Where = 'start' | 'end' | 'replace';

export type CaseChange = 'keep' | 'lower' | 'upper' | 'title' | 'sentence' | 'kebab' | 'snake';

export type DateSource = 'none' | 'today' | 'taken' | 'modified';

export type DateFormat =
  'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY-MM-DD_HH-mm-ss' | 'YYYYMMDD_HHmmss' | 'DD-MM-YYYY';

export const DATE_FORMATS: readonly DateFormat[] = [
  'YYYY-MM-DD',
  'YYYYMMDD',
  'YYYY-MM-DD_HH-mm-ss',
  'YYYYMMDD_HHmmss',
  'DD-MM-YYYY',
];

export type Remove = 'spaces' | 'digits' | 'special' | 'brackets';

export type SortBy = 'added' | 'name' | 'taken' | 'modified';

export interface RenameRules {
  find: string;
  replaceWith: string;
  regex: boolean;
  matchCase: boolean;
  remove: readonly Remove[];
  case: CaseChange;
  prefix: string;
  suffix: string;
  date: DateSource;
  dateFormat: DateFormat;
  dateWhere: Where;
  counter: boolean;
  counterStart: number;
  counterStep: number;
  /** Digits, zero-padded: 3 gives 001. */
  counterPad: number;
  counterWhere: Where;
  /** Between the stem and a date or counter added at the start or end. */
  separator: string;
  /** Without the dot; empty keeps each file's own. */
  extension: string;
  extensionCase: 'keep' | 'lower' | 'upper';
  sortBy: SortBy;
}

export const DEFAULT_RULES: RenameRules = {
  find: '',
  replaceWith: '',
  regex: false,
  matchCase: false,
  remove: [],
  case: 'keep',
  prefix: '',
  suffix: '',
  date: 'none',
  dateFormat: 'YYYY-MM-DD',
  dateWhere: 'start',
  counter: false,
  counterStart: 1,
  counterStep: 1,
  counterPad: 3,
  counterWhere: 'end',
  separator: '_',
  extension: '',
  extensionCase: 'keep',
  sortBy: 'added',
};

export class RenameError extends Error {}

export type Problem =
  'duplicate' | 'empty' | 'characters' | 'reserved' | 'ends' | 'long' | 'no-date';

export const PROBLEM_TEXT: Record<Problem, string> = {
  duplicate: 'Same name as another file',
  empty: 'No name left',
  characters: 'Has \\ / : * ? " < > | which disks don’t allow',
  reserved: 'A name Windows keeps for itself',
  ends: 'Ends with a dot or a space',
  long: 'Over 255 bytes',
  'no-date': 'No date taken in this file; its modified date is used',
};

export interface Planned {
  /** Index in the list as given. */
  index: number;
  from: string;
  to: string;
  problems: Problem[];
}

/** "clip.final.MP4" → ["clip.final", "MP4"]; a leading dot isn't an extension. */
export function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1
    ? [name, '']
    : [name.slice(0, dot), name.slice(dot + 1)];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A date in a format, in local time (what a camera writes and a person reads). */
export function formatDate(date: Date, format: DateFormat): string {
  const Y = String(date.getFullYear());
  const M = pad2(date.getMonth() + 1);
  const D = pad2(date.getDate());
  const h = pad2(date.getHours());
  const m = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  switch (format) {
    case 'YYYY-MM-DD':
      return `${Y}-${M}-${D}`;
    case 'YYYYMMDD':
      return `${Y}${M}${D}`;
    case 'YYYY-MM-DD_HH-mm-ss':
      return `${Y}-${M}-${D}_${h}-${m}-${s}`;
    case 'YYYYMMDD_HHmmss':
      return `${Y}${M}${D}_${h}${m}${s}`;
    case 'DD-MM-YYYY':
      return `${D}-${M}-${Y}`;
  }
}

const words = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);

export function changeCase(text: string, to: CaseChange): string {
  switch (to) {
    case 'keep':
      return text;
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text
        .toLowerCase()
        .replace(
          /(^|[\s_\-.([])(\p{L})/gu,
          (_, before: string, letter: string) => before + letter.toUpperCase(),
        );
    case 'sentence': {
      const lower = text.toLowerCase();
      return lower.replace(/\p{L}/u, (letter) => letter.toUpperCase());
    }
    case 'kebab':
      return words(text).join('-').toLowerCase();
    case 'snake':
      return words(text).join('_').toLowerCase();
  }
}

const REMOVERS: Record<Remove, RegExp> = {
  spaces: /\s+/g,
  digits: /\d+/g,
  // Anything but letters, digits, spaces, dots, dashes and underscores.
  special: /[^\p{L}\p{N}\s.\-_]+/gu,
  brackets: /\s*[([{][^)\]}]*[)\]}]/g,
};

/** The find pattern, checked once, or null when there's nothing to find. */
export function findPattern(
  rules: Pick<RenameRules, 'find' | 'regex' | 'matchCase'>,
): RegExp | null {
  if (!rules.find) return null;
  const flags = rules.matchCase ? 'gu' : 'giu';
  if (!rules.regex) return new RegExp(rules.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  try {
    return new RegExp(rules.find, flags);
  } catch (error) {
    throw new RenameError(
      `The pattern can’t be read: ${(error as Error).message.replace(/^Invalid regular expression: /, '')}`,
    );
  }
}

const place = (stem: string, part: string, where: Where, separator: string) =>
  where === 'replace'
    ? part
    : !stem
      ? part
      : where === 'start'
        ? `${part}${separator}${stem}`
        : `${stem}${separator}${part}`;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const BAD_CHARACTERS = /[\\/:*?"<>|]/;
/** Tabs, line breaks and the other control characters: no disk takes them in a name. */
function hasControl(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) if (name.charCodeAt(i) < 0x20) return true;
  return false;
}

/** What's wrong with a name on its own (clashes are found across the list). */
export function nameProblems(name: string, stem = splitName(name)[0]): Problem[] {
  const problems: Problem[] = [];
  if (!name || !stem.trim()) problems.push('empty');
  if (BAD_CHARACTERS.test(name) || hasControl(name)) problems.push('characters');
  if (WINDOWS_RESERVED.test(stem)) problems.push('reserved');
  if (/[. ]$/.test(name)) problems.push('ends');
  if (new TextEncoder().encode(name).length > 255) problems.push('long');
  return problems;
}

const time = (file: RenameFile, by: 'taken' | 'modified') =>
  (by === 'taken' ? (file.taken ?? file.modified) : file.modified).getTime();

/** The order the counter counts in. */
export function sortOrder(files: readonly RenameFile[], by: SortBy): number[] {
  const order = files.map((_, i) => i);
  if (by === 'added') return order;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return order.sort((a, b) => {
    const [fa, fb] = [files[a], files[b]];
    if (!fa || !fb) return 0;
    const diff = by === 'name' ? collator.compare(fa.name, fb.name) : time(fa, by) - time(fb, by);
    return diff || a - b;
  });
}

/** Every file's new name, in the counter's order, with what's wrong with each. */
export function planRenames(
  files: readonly RenameFile[],
  rules: RenameRules,
  today: Date,
): Planned[] {
  const pattern = findPattern(rules);
  const order = sortOrder(files, rules.sortBy);
  const planned = order.map((index, position): Planned => {
    const file = files[index] as RenameFile;
    let [stem, ext] = splitName(file.name);
    const problems: Problem[] = [];
    if (pattern) stem = stem.replace(pattern, rules.replaceWith);
    for (const what of rules.remove) stem = stem.replace(REMOVERS[what], '');
    stem = changeCase(stem, rules.case);
    stem = `${rules.prefix}${stem}${rules.suffix}`;
    if (rules.date !== 'none') {
      if (rules.date === 'taken' && !file.taken) problems.push('no-date');
      const date =
        rules.date === 'today'
          ? today
          : rules.date === 'taken'
            ? (file.taken ?? file.modified)
            : file.modified;
      stem = place(stem, formatDate(date, rules.dateFormat), rules.dateWhere, rules.separator);
    }
    if (rules.counter) {
      const n = rules.counterStart + position * rules.counterStep;
      const digits = String(Math.abs(n)).padStart(Math.max(1, rules.counterPad), '0');
      stem = place(stem, n < 0 ? `-${digits}` : digits, rules.counterWhere, rules.separator);
    }
    if (rules.extension) ext = rules.extension.replace(/^\.+/, '');
    if (rules.extensionCase === 'lower') ext = ext.toLowerCase();
    if (rules.extensionCase === 'upper') ext = ext.toUpperCase();
    const to = ext ? `${stem}.${ext}` : stem;
    return { index, from: file.name, to, problems: [...nameProblems(to, stem), ...problems] };
  });
  // Disks on Windows and macOS ignore case, so "A.jpg" and "a.jpg" clash.
  const seen = new Map<string, number>();
  for (const plan of planned) {
    const key = plan.to.normalize('NFC').toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const plan of planned) {
    if ((seen.get(plan.to.normalize('NFC').toLowerCase()) ?? 0) > 1)
      plan.problems.unshift('duplicate');
  }
  return planned;
}

/** Whether a problem stops the rename (a missing date only warns). */
export const blocking = (problem: Problem) => problem !== 'no-date';
