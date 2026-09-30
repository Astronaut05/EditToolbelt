/**
 * Tolerant subtitle parsing (tools/subtitles-and-time.md → shared rules):
 * BOMs, CRLF or LF, missing blank lines, comma or dot milliseconds. Anything
 * a cue can't carry (see types.ts → Cue) is removed here and counted.
 */
import { parseTime } from './time';
import { count, type Cue, type Dropped, type ParsedSubtitles, type SubtitleFormat } from './types';

/** No BOM, "\n" line endings. */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

const ARROW = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/;
const SBV_TIMING =
  /^\s*(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*,\s*(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*$/;

export function extensionOf(fileName: string | undefined): SubtitleFormat | null {
  const ext = fileName?.toLowerCase().split('.').pop();
  return ext === 'srt' || ext === 'vtt' || ext === 'ass' || ext === 'ssa' || ext === 'sbv'
    ? ext
    : ext === 'webvtt'
      ? 'vtt'
      : null;
}

/** The format of a subtitle file, by its content first and its name second. */
export function detectFormat(text: string, fileName?: string): SubtitleFormat | null {
  const body = normalizeText(text).trimStart();
  const byName = extensionOf(fileName);
  if (/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(body)) return 'vtt';
  if (/^\[Script Info\]/im.test(body) || /^Dialogue:/m.test(body)) {
    if (/^ScriptType:\s*v4\.00\+/im.test(body)) return 'ass';
    if (/^ScriptType:\s*v4\.00\b/im.test(body)) return 'ssa';
    return byName === 'ssa' ? 'ssa' : 'ass';
  }
  if (body.split('\n', 20).some((line) => SBV_TIMING.test(line))) return 'sbv';
  if (/-->/.test(body)) return byName === 'vtt' ? 'vtt' : 'srt';
  return byName;
}

/** Cue text as the model keeps it: trimmed lines, no empty lines. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** Closes <i>, <b> and <u> left open at the end of a cue, and drops empty pairs. */
function balance(text: string): string {
  let out = text;
  for (const tag of ['i', 'b', 'u']) {
    const opens = (out.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
    const closes = (out.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    if (opens > closes) out += `</${tag}>`.repeat(opens - closes);
    out = out.replaceAll(`<${tag}></${tag}>`, '');
  }
  return out;
}

function pushCue(
  cues: Cue[],
  dropped: Dropped,
  start: number | null,
  end: number | null,
  text: string,
) {
  if (start === null || end === null) {
    count(dropped, 'badTimes');
    return;
  }
  const clean = tidy(balance(text));
  if (!clean.replace(/<\/?[ibu]>/g, '').trim()) {
    count(dropped, 'emptyCues');
    return;
  }
  cues.push({ start, end: Math.max(start, end), text: clean });
}

/**
 * Walks lines and collects cues: a timing line, then text until a blank line,
 * or until the next cue starts (a missing blank line).
 */
function collect(
  text: string,
  timing: (line: string) => { start: number | null; end: number | null; rest: string } | null,
  clean: (body: string, dropped: Dropped, rest: string) => string,
): { cues: Cue[]; dropped: Dropped } {
  const lines = normalizeText(text).split('\n');
  const cues: Cue[] = [];
  const dropped: Dropped = {};
  let i = 0;
  while (i < lines.length) {
    const found = timing(lines[i] ?? '');
    i += 1;
    if (!found) continue;
    const body: string[] = [];
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (line.trim() === '' || timing(line)) break;
      // An index line right before the next timing line starts a new cue.
      if (/^\d+\s*$/.test(line) && timing(lines[i + 1] ?? '')) break;
      body.push(line);
      i += 1;
    }
    pushCue(cues, dropped, found.start, found.end, clean(body.join('\n'), dropped, found.rest));
  }
  return { cues, dropped };
}

function arrowTiming(line: string) {
  const match = ARROW.exec(line);
  if (!match) return null;
  return { start: parseTime(match[1] ?? ''), end: parseTime(match[2] ?? ''), rest: match[3] ?? '' };
}

/** Keeps <i>, <b> and <u> (any case, with or without attributes or VTT classes) as bare tags. */
function normalizeBasicTags(text: string): string {
  return text.replace(
    /<(\/?)([ibu])(?:[.\s][^>]*)?>/gi,
    (_, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`,
  );
}

export function parseSrt(text: string): ParsedSubtitles {
  const { cues, dropped } = collect(text, arrowTiming, (body, found) => {
    let out = body;
    // {\an8} and friends: ASS position codes some SRT files carry.
    out = out.replace(/\{\\[^}]*\}/g, () => {
      count(found, 'srtPosition');
      return '';
    });
    out = normalizeBasicTags(out);
    // <font color=…>, <span>, <s> …: removed, text kept.
    out = out.replace(/<\/?(?![ibu]>)[a-z][^>]*>/gi, (tag) => {
      if (!tag.startsWith('</')) count(found, 'srtFont');
      return '';
    });
    return out;
  });
  return { format: 'srt', cues, dropped };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  lrm: '‎',
  rlm: '‏',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function parseVtt(text: string): ParsedSubtitles {
  const normalized = normalizeText(text);
  const blocks = normalized.split(/\n{2,}/);
  const header: Dropped = {};
  for (const block of blocks.slice(1)) {
    if (/^(STYLE|REGION)\b/.test(block.trimStart())) {
      count(header, 'vttBlocks');
    }
  }
  const { cues, dropped } = collect(normalized, arrowTiming, (body, found, rest) => {
    if (rest.trim()) count(found, 'vttSettings');
    let out = body;
    out = out.replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, () => {
      count(found, 'vttTimestamps');
      return '';
    });
    out = out.replace(/<v(?:\.[^\s>]+)?(?:\s[^>]*)?>|<\/v>/g, (tag) => {
      if (tag !== '</v>') count(found, 'vttVoices');
      return '';
    });
    out = out.replace(/<\/?(?:c|lang|ruby|rt)(?:[.\s][^>]*)?>/g, (tag) => {
      if (!tag.startsWith('</')) count(found, 'vttClasses');
      return '';
    });
    out = normalizeBasicTags(out);
    return decodeEntities(out);
  });
  for (const [kind, value] of Object.entries(header) as [keyof Dropped, number][]) {
    count(dropped, kind, value);
  }
  return { format: 'vtt', cues, dropped };
}

export function parseSbv(text: string): ParsedSubtitles {
  const { cues, dropped } = collect(
    text,
    (line) => {
      const match = SBV_TIMING.exec(line);
      return match
        ? { start: parseTime(match[1] ?? ''), end: parseTime(match[2] ?? ''), rest: '' }
        : null;
    },
    (body) => body,
  );
  return { format: 'sbv', cues, dropped };
}

interface AssStyle {
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

const ASS_EVENT_FORMAT = [
  'layer',
  'start',
  'end',
  'style',
  'name',
  'marginl',
  'marginr',
  'marginv',
  'effect',
  'text',
];

/** ASS/SSA "-1" or "1" is on; "0" is off. */
const on = (value: string | undefined) =>
  value !== undefined && value.trim() !== '0' && value.trim() !== '';

/**
 * Converts one Dialogue text: \N and \n to line breaks, \h to a space, and
 * {\i1}{\b1}{\u1} to tags when `keepStyling` (spec: optional). Every other
 * override is removed and counted.
 */
function assText(
  raw: string,
  style: AssStyle | undefined,
  keepStyling: boolean,
  dropped: Dropped,
): string {
  let text = raw.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  text = text.replace(/\{([^}]*)\}/g, (_, block: string) => {
    let out = '';
    let removed = false;
    const tags = block.match(/\\[^\\]*/g) ?? [];
    if (tags.length === 0 && block.trim()) removed = true; // a {comment}
    for (const tag of tags) {
      const basic = /^\\([ibu])(\d*)$/.exec(tag.trim());
      if (basic && keepStyling) {
        const [, name = 'i', value = '1'] = basic;
        // \b takes a weight too: 700 is bold, 400 is not.
        const isOn = name === 'b' && value.length > 1 ? Number(value) >= 600 : value !== '0';
        out += isOn ? `<${name}>` : `</${name}>`;
      } else {
        removed = true;
      }
    }
    if (removed) count(dropped, 'assOverrides');
    return out;
  });
  if (keepStyling && style) {
    for (const [flag, tag] of [
      [style.italic, 'i'],
      [style.bold, 'b'],
      [style.underline, 'u'],
    ] as const) {
      if (flag) text = `<${tag}>${text}</${tag}>`;
    }
  }
  return text;
}

export function parseAss(text: string, keepStyling = true): ParsedSubtitles {
  const lines = normalizeText(text).split('\n');
  const dropped: Dropped = {};
  const cues: Cue[] = [];
  const styles = new Map<string, AssStyle>();
  let section = '';
  let format = ASS_EVENT_FORMAT;
  let styleFormat: string[] = [];
  let ssa = false;

  for (const line of lines) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line);
    if (header) {
      section = (header[1] ?? '').toLowerCase();
      continue;
    }
    const field = /^\s*([A-Za-z]+)\s*:\s?(.*)$/.exec(line);
    if (!field) continue;
    const key = (field[1] ?? '').toLowerCase();
    const value = field[2] ?? '';
    if (section === 'script info' && key === 'scripttype') ssa = !/v4\.00\+/i.test(value);
    if (section.endsWith('styles')) {
      if (key === 'format') styleFormat = value.split(',').map((name) => name.trim().toLowerCase());
      if (key === 'style') {
        const values = value.split(',');
        const get = (name: string) => values[styleFormat.indexOf(name)];
        styles.set((get('name') ?? '').trim(), {
          italic: on(get('italic')),
          bold: on(get('bold')),
          underline: on(get('underline')),
        });
      }
      continue;
    }
    if (section !== 'events') continue;
    if (key === 'format') {
      format = value.split(',').map((name) => name.trim().toLowerCase());
      continue;
    }
    if (key === 'comment') {
      count(dropped, 'assComments');
      continue;
    }
    if (key !== 'dialogue') continue;
    const values: string[] = [];
    let rest = value;
    for (let f = 0; f < format.length - 1; f += 1) {
      const comma = rest.indexOf(',');
      if (comma < 0) break;
      values.push(rest.slice(0, comma));
      rest = rest.slice(comma + 1);
    }
    values.push(rest);
    const get = (name: string) => values[format.indexOf(name)];
    const body = get('text') ?? '';
    if (/\{[^}]*\\p[1-9]/.test(body)) {
      count(dropped, 'assDrawings');
      continue;
    }
    const style = styles.get((get('style') ?? '').replace(/^\*/, '').trim());
    pushCue(
      cues,
      dropped,
      parseTime(get('start') ?? ''),
      parseTime(get('end') ?? ''),
      assText(body, style, keepStyling, dropped),
    );
  }
  // ASS files list events in any order; subtitles play by time.
  cues.sort((a, b) => a.start - b.start);
  return { format: ssa ? 'ssa' : 'ass', cues, dropped };
}

export interface ParseOptions {
  /** ASS/SSA: turn {\i1}, {\b1}, {\u1} and italic styles into tags (default on). */
  keepStyling?: boolean;
}

export function parseSubtitles(
  text: string,
  format: Exclude<SubtitleFormat, 'txt'>,
  options: ParseOptions = {},
): ParsedSubtitles {
  switch (format) {
    case 'srt':
      return parseSrt(text);
    case 'vtt':
      return parseVtt(text);
    case 'sbv':
      return parseSbv(text);
    case 'ass':
    case 'ssa':
      return parseAss(text, options.keepStyling ?? true);
  }
}
