/**
 * T03 Subtitle Editor (tools/subtitles-and-time.md): the editing rules,
 * pure, so the editor, its tests and the Premiere panel agree. The checks a
 * subtitler runs before delivery (characters per line, lines per cue,
 * reading speed, duration, the gap between cues, overlaps), each with a fix
 * that changes as little as it can, and the edits themselves: split, merge,
 * find and replace. Cues are kept in order of their start; times in ms.
 */
import type { Cue } from './types';

export interface CheckRules {
  /** Characters on one line. */
  maxCpl: number;
  maxLines: number;
  /** Characters per second, counting everything but the line breaks. */
  maxCps: number;
  /** Shortest and longest time on screen, ms. */
  minDuration: number;
  maxDuration: number;
  /** The least time between one cue and the next, ms. */
  minGap: number;
}

/** Common delivery rules: 42 characters, 2 lines, 17 cps, 5/6 s to 7 s, 2 frames (at 24 fps) apart. */
export const DEFAULT_RULES: CheckRules = {
  maxCpl: 42,
  maxLines: 2,
  maxCps: 17,
  minDuration: 833,
  maxDuration: 7000,
  minGap: 83,
};

export type IssueKind = 'empty' | 'cpl' | 'lines' | 'cps' | 'short' | 'long' | 'gap' | 'overlap';

export interface Issue {
  /** The cue's place in the list (for gap and overlap, the first of the two). */
  index: number;
  kind: IssueKind;
  /** In plain words, with the numbers: "48 characters on a line (42 at most)". */
  detail: string;
}

/** What a check is called, for the list of checks. */
export const ISSUE_LABELS: Record<IssueKind, string> = {
  empty: 'Empty cues',
  cpl: 'Lines too long',
  lines: 'Too many lines',
  cps: 'Reading speed too high',
  short: 'Too short',
  long: 'Too long',
  gap: 'Gaps too small',
  overlap: 'Overlaps',
};

/** The words as shown: the <i>, <b> and <u> tags left out. */
export const visibleText = (text: string) => text.replace(/<\/?[biu]>/g, '');

const lines = (text: string) => visibleText(text).split('\n');

/** Characters per second, line breaks not counted. */
export function readingSpeed(cue: Cue): number {
  const chars = visibleText(cue.text).replace(/\n/g, '').length;
  const seconds = Math.max(1, cue.end - cue.start) / 1000;
  return chars / seconds;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** Every rule a cue or pair of cues breaks, in list order. */
export function checkCues(cues: readonly Cue[], rules: CheckRules = DEFAULT_RULES): Issue[] {
  const issues: Issue[] = [];
  cues.forEach((cue, index) => {
    const words = visibleText(cue.text).trim();
    if (!words) {
      issues.push({ index, kind: 'empty', detail: 'No text' });
      return;
    }
    const longest = Math.max(...lines(cue.text).map((line) => line.length));
    if (longest > rules.maxCpl) {
      issues.push({
        index,
        kind: 'cpl',
        detail: `${String(longest)} characters on a line (${String(rules.maxCpl)} at most)`,
      });
    }
    const count = lines(cue.text).length;
    if (count > rules.maxLines) {
      issues.push({
        index,
        kind: 'lines',
        detail: `${String(count)} lines (${String(rules.maxLines)} at most)`,
      });
    }
    const cps = readingSpeed(cue);
    if (cps > rules.maxCps) {
      issues.push({
        index,
        kind: 'cps',
        detail: `${cps.toFixed(1)} characters a second (${String(rules.maxCps)} at most)`,
      });
    }
    const duration = cue.end - cue.start;
    if (duration < rules.minDuration) {
      issues.push({
        index,
        kind: 'short',
        detail: `${sec(duration)} on screen (${sec(rules.minDuration)} at least)`,
      });
    } else if (duration > rules.maxDuration) {
      issues.push({
        index,
        kind: 'long',
        detail: `${sec(duration)} on screen (${sec(rules.maxDuration)} at most)`,
      });
    }
    const next = cues[index + 1];
    if (next) {
      const gap = next.start - cue.end;
      if (gap < 0) {
        issues.push({ index, kind: 'overlap', detail: `Runs ${sec(-gap)} into the next cue` });
      } else if (gap > 0 && gap < rules.minGap) {
        // Cues that touch (gap 0) are fine: back to back is a common choice.
        issues.push({
          index,
          kind: 'gap',
          detail: `${String(gap)} ms before the next cue (${String(rules.minGap)} ms at least)`,
        });
      }
    }
  });
  return issues;
}

/**
 * The text rewrapped into lines of at most `maxCpl` characters, as few lines
 * as it can and as even as they can be (the classic two-line "pyramid").
 * Tags stay where they are; a word longer than a line stays whole.
 */
export function rewrap(text: string, maxCpl: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const length = (from: number, to: number) => visibleText(words.slice(from, to).join(' ')).length;
  // Fewest lines first; among those, the split whose longest line is shortest.
  for (let count = 1; count <= words.length; count += 1) {
    const best: { cuts: number[] | null; longest: number } = { cuts: null, longest: Infinity };
    const search = (from: number, left: number, cuts: number[]) => {
      if (left === 1) {
        const longest = Math.max(
          length(from, words.length),
          ...cuts.map((cut, i) => length(i === 0 ? 0 : (cuts[i - 1] ?? 0), cut)),
        );
        if (length(from, words.length) <= maxCpl && longest < best.longest) {
          best.longest = longest;
          best.cuts = [...cuts];
        }
        return;
      }
      for (let cut = from + 1; cut <= words.length - left + 1; cut += 1) {
        if (length(from, cut) > maxCpl) break;
        search(cut, left - 1, [...cuts, cut]);
      }
    };
    // Searching every split is quick for a cue's few words; past 4 lines, fill greedily.
    if (count > 4) break;
    search(0, count, []);
    if (best.cuts) {
      const bounds = [0, ...best.cuts, words.length];
      return bounds
        .slice(0, -1)
        .map((from, i) => words.slice(from, bounds[i + 1]).join(' '))
        .join('\n');
    }
  }
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const tried = line ? `${line} ${word}` : word;
    if (visibleText(tried).length <= maxCpl || !line) line = tried;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}

/** Room around cue i: how early it may start and how late it may end without crowding its neighbours. */
function room(cues: readonly Cue[], i: number, rules: CheckRules) {
  const prev = cues[i - 1];
  const next = cues[i + 1];
  return {
    earliest: prev ? prev.end + rules.minGap : 0,
    latest: next ? next.start - rules.minGap : Infinity,
  };
}

const replaceAt = (cues: readonly Cue[], i: number, cue: Cue) =>
  cues.map((c, j) => (j === i ? cue : c));

/**
 * Fixes one issue, changing as little as it can, and returns the new list
 * (the same list when it can't be fixed without moving other cues).
 */
export function fixIssue(
  cues: readonly Cue[],
  issue: Issue,
  rules: CheckRules = DEFAULT_RULES,
): Cue[] {
  const i = issue.index;
  const cue = cues[i];
  if (!cue) return [...cues];
  const { earliest, latest } = room(cues, i, rules);
  switch (issue.kind) {
    case 'empty':
      return cues.filter((_, j) => j !== i);
    case 'cpl':
    case 'lines':
      return replaceAt(cues, i, { ...cue, text: rewrap(cue.text, rules.maxCpl) });
    case 'cps':
    case 'short': {
      // Longer on screen: later end first, then earlier start, within the gaps either side.
      const chars = visibleText(cue.text).replace(/\n/g, '').length;
      const need = Math.max(
        issue.kind === 'short' ? rules.minDuration : 0,
        Math.ceil((chars / rules.maxCps) * 1000),
        cue.end - cue.start,
      );
      const end = Math.min(Math.max(cue.end, cue.start + need), Math.max(cue.end, latest));
      const start = Math.max(Math.min(cue.start, end - need), Math.min(cue.start, earliest));
      return replaceAt(cues, i, { ...cue, start, end });
    }
    case 'long':
      return replaceAt(cues, i, { ...cue, end: cue.start + rules.maxDuration });
    case 'gap':
    case 'overlap': {
      // The first cue ends earlier; if that would leave it too short, the next starts later.
      const next = cues[i + 1];
      if (!next) return [...cues];
      const end = next.start - rules.minGap;
      if (end - cue.start >= Math.min(rules.minDuration, cue.end - cue.start)) {
        return replaceAt(cues, i, { ...cue, end });
      }
      const start = cue.end + rules.minGap;
      return replaceAt(cues, i + 1, { ...next, start: Math.min(start, next.end - 1) });
    }
  }
}

/** Every issue of one kind fixed, from the end back so earlier fixes don't shift later ones. */
export function fixAll(
  cues: readonly Cue[],
  kind: IssueKind,
  rules: CheckRules = DEFAULT_RULES,
): Cue[] {
  let out = [...cues];
  const issues = checkCues(out, rules)
    .filter((issue) => issue.kind === kind)
    .reverse();
  for (const issue of issues) out = fixIssue(out, issue, rules);
  return out;
}

/**
 * Cue i split at `at` ms: its words shared by time (a two-line cue splits
 * between its lines), the first ending a minimum gap before the second.
 */
export function splitCue(
  cues: readonly Cue[],
  i: number,
  at: number,
  rules: CheckRules = DEFAULT_RULES,
): Cue[] {
  const cue = cues[i];
  if (!cue || at <= cue.start || at >= cue.end) return [...cues];
  const share = (at - cue.start) / (cue.end - cue.start);
  const parts = cue.text.split('\n');
  let first: string;
  let second: string;
  if (parts.length === 2) {
    [first, second] = [parts[0] ?? '', parts[1] ?? ''];
  } else {
    const words = cue.text.split(/\s+/).filter(Boolean);
    const cut = Math.min(words.length - 1, Math.max(1, Math.round(words.length * share)));
    first = words.slice(0, cut).join(' ');
    second = words.slice(cut).join(' ');
  }
  const end = Math.max(cue.start + 1, at - rules.minGap);
  return [
    ...cues.slice(0, i),
    { start: cue.start, end, text: first },
    { start: at, end: cue.end, text: second },
    ...cues.slice(i + 1),
  ];
}

/** Cue i and the next as one: from the first's start to the second's end, the texts on two lines. */
export function mergeCues(cues: readonly Cue[], i: number): Cue[] {
  const a = cues[i];
  const b = cues[i + 1];
  if (!a || !b) return [...cues];
  const text = [a.text, b.text]
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n');
  return [
    ...cues.slice(0, i),
    { start: a.start, end: Math.max(a.end, b.end), text },
    ...cues.slice(i + 2),
  ];
}

/** The list in order of start (then end), as the editor keeps it after a move. */
export function sortCues(cues: readonly Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

function pattern(query: string, options: FindOptions): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(body, options.matchCase ? 'gu' : 'giu');
}

/** Where `query` appears: each cue's index and the match's place in its text. */
export function findInCues(
  cues: readonly Cue[],
  query: string,
  options: FindOptions = {},
): { index: number; from: number; to: number }[] {
  if (!query) return [];
  const re = pattern(query, options);
  const found: { index: number; from: number; to: number }[] = [];
  cues.forEach((cue, index) => {
    for (const m of cue.text.matchAll(re)) {
      found.push({ index, from: m.index, to: m.index + m[0].length });
    }
  });
  return found;
}

/** Every match replaced (the replacement taken literally), and how many there were. */
export function replaceInCues(
  cues: readonly Cue[],
  query: string,
  replacement: string,
  options: FindOptions = {},
): { cues: Cue[]; count: number } {
  if (!query) return { cues: [...cues], count: 0 };
  const re = pattern(query, options);
  let count = 0;
  const out = cues.map((cue) => {
    const text = cue.text.replace(re, () => {
      count += 1;
      return replacement;
    });
    return text === cue.text ? cue : { ...cue, text };
  });
  return { cues: out, count };
}
