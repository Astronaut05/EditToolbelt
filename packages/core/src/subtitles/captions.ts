/**
 * T09 Subtitle Generator (tools/subtitles-and-time.md): Gemini hears the
 * speech, writes it word by word with times and groups the words into cues
 * by meaning. This is everything around that answer that doesn't need the
 * network: the prompt and the schema that ask for it, the clips a long
 * recording is sent in, a tolerant reading of the reply, and the rules every
 * cue keeps whatever the model returned (the style's word and line limits,
 * cue edges on the speech, no gap under the set pause, no overlap, valid
 * times). Pure, so the Premiere panel can use it too.
 */
import { autoThreshold, LEVEL_STEP } from '../audio/silence';
import { rewrap } from './edit';
import type { Cue } from './types';

// ── Styles ───────────────────────────────────────────────────────────────────

export type CaptionStyleId = 'instagram' | 'phrase' | 'youtube';

export interface CaptionStyle {
  /** Words a cue aims for; the model may go one under or over to keep a phrase whole. */
  minWords: number;
  maxWords: number;
  /** Lines on screen at most, and characters a line holds before a cue is split. */
  lines: 1 | 2;
  lineChars: number;
  /** Drop a period, comma, colon or semicolon that ends a cue ("?" and "!" stay). */
  bareEnds: boolean;
}

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyle> = {
  // Reels, Shorts and TikTok: a few words at a time, one line, read at a glance.
  instagram: { minWords: 2, maxWords: 4, lines: 1, lineChars: 40, bareEnds: true },
  // One line, a short phrase.
  phrase: { minWords: 4, maxWords: 7, lines: 1, lineChars: 42, bareEnds: true },
  // Classic subtitles: up to two lines of 42 characters.
  youtube: { minWords: 5, maxWords: 14, lines: 2, lineChars: 42, bareEnds: false },
};

export function captionStyle(id: string | undefined): CaptionStyle {
  return id && id in CAPTION_STYLES
    ? CAPTION_STYLES[id as CaptionStyleId]
    : CAPTION_STYLES.instagram;
}

// ── Words and cues as the model gives them ───────────────────────────────────

/** A word with its time in seconds, from the start of the clip (or, once placed, the file). */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** A cue as the model grouped it: its words in order. */
export interface WordCue {
  words: TimedWord[];
}

export class CaptionReplyError extends Error {
  override name = 'CaptionReplyError';
}

/**
 * Seconds from what a model writes for a time: 12.34, "12.34", "12.34s",
 * "00:12.340", "1:02:03,5". NaN when it's none of those.
 */
export function parseSeconds(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value.trim().replace(',', '.').replace(/s$/i, '');
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return NaN;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * What's inside a reply's first ``` fence, without its "json" tag, or null.
 * Found by position: a pattern would backtrack on a long reply from the network.
 */
function fenced(text: string): string | null {
  const open = text.indexOf('```');
  const close = open < 0 ? -1 : text.indexOf('```', open + 3);
  if (close < 0) return null;
  return text
    .slice(open + 3, close)
    .replace(/^json/i, '')
    .trim();
}

/** Characters at the end of `text` that are in `chars`, dropped (no backtracking pattern). */
function trimEndOf(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** The JSON in a reply: as it is, inside a ``` fence, or the outermost {...} in it. */
function jsonOf(reply: string): unknown {
  const text = reply.trim();
  for (const candidate of [
    text,
    fenced(text),
    text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1),
  ]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next reading.
    }
  }
  throw new CaptionReplyError('Gemini’s reply wasn’t the JSON it was asked for.');
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** A cue that came as text with a start and an end: its words, timed by their length. */
function spreadWords(text: string, start: number, end: number): TimedWord[] {
  const words = text.split(' ').filter(Boolean);
  const weights = words.map((word) => word.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let at = start;
  return words.map((word, i) => {
    const length = ((end - start) * (weights[i] ?? 1)) / total;
    const timed = { text: word, start: at, end: at + length };
    at += length;
    return timed;
  });
}

/**
 * The cues in a reply, read tolerantly: `{ cues: [{ words: [{ w, s, e }] }] }`
 * as asked, longer key names, a bare list, or a cue with `text`, `start` and
 * `end` and no words (its words are then timed by their length). Words keep
 * the times written; `repairClipTimes` puts them in order.
 */
export function readCaptionReply(reply: string): WordCue[] {
  const root = jsonOf(reply);
  const list = Array.isArray(root)
    ? root
    : (record(root).cues ?? record(root).segments ?? record(root).subtitles);
  if (!Array.isArray(list)) {
    throw new CaptionReplyError('Gemini’s reply had no list of cues in it.');
  }
  const cues: WordCue[] = [];
  for (const item of list) {
    const cue = record(item);
    const words: TimedWord[] = [];
    if (Array.isArray(cue.words)) {
      for (const raw of cue.words) {
        const word = record(raw);
        const text = textOf(word.w ?? word.word ?? word.text);
        if (!text) continue;
        // A "word" with spaces in it is several: share its time out.
        const start = parseSeconds(word.s ?? word.start);
        const end = parseSeconds(word.e ?? word.end);
        words.push(
          ...(text.includes(' ') ? spreadWords(text, start, end) : [{ text, start, end }]),
        );
      }
    } else {
      const text = textOf(cue.text);
      if (text) words.push(...spreadWords(text, parseSeconds(cue.start), parseSeconds(cue.end)));
    }
    if (words.length > 0) cues.push({ words });
  }
  return cues;
}

/** Shortest time a word is given when the model's times leave it none. */
const MIN_WORD = 0.08;

/**
 * Times a model may get wrong, put right within one clip: milliseconds
 * written for seconds (every time 1000× the clip), missing times taken from
 * the neighbours, times clamped to the clip, every word after the one before
 * it, and each word at least a little long.
 */
export function repairClipTimes(cues: readonly WordCue[], clipSec: number): WordCue[] {
  const all = cues.flatMap((cue) => cue.words);
  const latest = Math.max(0, ...all.map((w) => w.end).filter(Number.isFinite));
  const scale = latest > clipSec * 1.5 && latest / 1000 <= clipSec * 1.1 ? 1 / 1000 : 1;
  let previous = 0;
  return cues
    .map((cue) => ({
      words: cue.words.map((word) => {
        let start = word.start * scale;
        let end = word.end * scale;
        if (!Number.isFinite(start)) start = previous;
        if (!Number.isFinite(end) || end < start) end = start + MIN_WORD;
        start = Math.min(Math.max(start, previous), clipSec);
        end = Math.min(Math.max(end, start + MIN_WORD), clipSec);
        if (end <= start) start = Math.max(previous, end - MIN_WORD);
        previous = end;
        return { text: word.text, start, end };
      }),
    }))
    .filter((cue) => cue.words.length > 0);
}

/** The clip's words moved onto the file's timeline. */
export function offsetCues(cues: readonly WordCue[], by: number): WordCue[] {
  return cues.map((cue) => ({
    words: cue.words.map((w) => ({ text: w.text, start: w.start + by, end: w.end + by })),
  }));
}

// ── Keeping the style ────────────────────────────────────────────────────────

const PUNCTUATED = /[.,;:!?…»")\]]$/;
const SENTENCE_END = /[.!?…]["»)\]]?$/;

const cueText = (words: readonly TimedWord[]) => words.map((w) => w.text).join(' ');

/** Whether a cue fits the style: words, and characters across its lines. */
function fits(words: readonly TimedWord[], style: CaptionStyle): boolean {
  return (
    words.length <= style.maxWords + 1 && cueText(words).length <= style.lines * style.lineChars
  );
}

/**
 * The best place to split a cue that's too long: after punctuation or a
 * pause if there is one near the middle, with neither side under the style's
 * fewest words where that can be helped.
 */
function splitAt(words: readonly TimedWord[], style: CaptionStyle): number {
  let best = 1;
  let bestScore = -Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const before = words[i - 1];
    const after = words[i];
    if (!before || !after) continue;
    const left = i;
    const right = words.length - i;
    let score = -Math.abs(left - right);
    if (PUNCTUATED.test(before.text)) score += 3;
    if (after.start - before.end >= 0.2) score += 2;
    if (Math.min(left, right) < Math.min(style.minWords, Math.floor(words.length / 2))) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function splitToFit(words: TimedWord[], style: CaptionStyle): TimedWord[][] {
  if (words.length <= 1 || fits(words, style)) return [words];
  const at = splitAt(words, style);
  return [...splitToFit(words.slice(0, at), style), ...splitToFit(words.slice(at), style)];
}

/**
 * The model's cues held to the style: one too long is split by meaning
 * (punctuation, then pauses, then the middle); a single word is joined to a
 * neighbour it runs into (no pause, same sentence) when the two still fit.
 */
export function fitStyle(cues: readonly WordCue[], style: CaptionStyle): WordCue[] {
  const split = cues.flatMap((cue) =>
    splitToFit(cue.words, style).map((words) => ({ words: [...words] })),
  );
  if (style.minWords < 2) return split;
  const out: WordCue[] = [];
  for (let i = 0; i < split.length; i += 1) {
    const cue = split[i];
    if (!cue) continue;
    const last = out[out.length - 1];
    const lastWord = last?.words[last.words.length - 1];
    const first = cue.words[0];
    // Joined to the cue before it: no pause, no sentence end between them.
    if (
      cue.words.length === 1 &&
      last &&
      lastWord &&
      first &&
      first.start - lastWord.end < 0.25 &&
      !SENTENCE_END.test(lastWord.text) &&
      fits([...last.words, first], style) &&
      last.words.length + 1 <= style.maxWords
    ) {
      last.words.push(first);
      continue;
    }
    // Or the cue after it, when it can't go back.
    const next = split[i + 1];
    const nextFirst = next?.words[0];
    if (
      cue.words.length === 1 &&
      next &&
      first &&
      nextFirst &&
      nextFirst.start - first.end < 0.25 &&
      !SENTENCE_END.test(first.text) &&
      fits([first, ...next.words], style) &&
      next.words.length + 1 <= style.maxWords
    ) {
      next.words.unshift(first);
      continue;
    }
    out.push({ words: [...cue.words] });
  }
  return out;
}

// ── Speech, from the recording's levels ──────────────────────────────────────

/**
 * Where there's speech, every 10 ms (LEVEL_STEP), from the levels Remove
 * Silence reads: above the noise floor's threshold, with dips under 80 ms
 * (between syllables) filled and blips under 50 ms (a click) dropped.
 */
export function speechMask(levels: Float32Array, thresholdDb = autoThreshold(levels)): Uint8Array {
  const mask = new Uint8Array(levels.length);
  for (let i = 0; i < levels.length; i += 1)
    mask[i] = (levels[i] ?? -Infinity) >= thresholdDb ? 1 : 0;
  // Runs of `value` shorter than `frames`, with something else on both sides, become the other value.
  const fill = (value: 0 | 1, frames: number) => {
    for (let i = 0; i < mask.length;) {
      if (mask[i] !== value) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < mask.length && mask[j] === value) j += 1;
      if (j - i < frames && i > 0 && j < mask.length) mask.fill(value === 1 ? 0 : 1, i, j);
      i = j;
    }
  };
  fill(0, Math.round(0.08 / LEVEL_STEP));
  fill(1, Math.round(0.05 / LEVEL_STEP));
  return mask;
}

/** The speech edge (onset or offset) nearest `at` within `reach` seconds, or null. */
function nearestEdge(mask: Uint8Array, at: number, reach: number, onset: boolean): number | null {
  const centre = Math.round(at / LEVEL_STEP);
  const span = Math.round(reach / LEVEL_STEP);
  let best: number | null = null;
  for (let i = Math.max(1, centre - span); i <= Math.min(mask.length - 1, centre + span); i += 1) {
    const edge = onset ? mask[i - 1] === 0 && mask[i] === 1 : mask[i - 1] === 1 && mask[i] === 0;
    if (edge && (best === null || Math.abs(i - centre) < Math.abs(best - centre))) best = i;
  }
  return best === null ? null : best * LEVEL_STEP;
}

// ── Clips: how a long recording is sent ──────────────────────────────────────

export interface Clip {
  start: number;
  end: number;
}

/**
 * Where to cut a recording into clips the model times well: none under
 * `longest` seconds; otherwise each cut in the longest pause between `shortest`
 * and `longest` seconds into the clip (nearer `target` on a tie), or at the
 * quietest moment if no one pauses. No clip ever cuts through a word that has
 * a pause anywhere near.
 */
export function planClips(
  levels: Float32Array,
  durationSec: number,
  { target = 75, longest = 110, shortest = 40 } = {},
): Clip[] {
  if (durationSec <= longest) return [{ start: 0, end: durationSec }];
  const mask = speechMask(levels);
  const clips: Clip[] = [];
  let from = 0;
  while (durationSec - from > longest) {
    const lo = Math.round((from + shortest) / LEVEL_STEP);
    const hi = Math.min(mask.length, Math.round((from + longest) / LEVEL_STEP));
    let cut = -1;
    let bestLength = 0;
    let bestDistance = Infinity;
    for (let i = lo; i < hi;) {
      if (mask[i] === 1) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < hi && mask[j] === 0) j += 1;
      const middle = Math.floor((i + j) / 2);
      const distance = Math.abs(middle * LEVEL_STEP - (from + target));
      if (j - i > bestLength || (j - i === bestLength && distance < bestDistance)) {
        bestLength = j - i;
        bestDistance = distance;
        cut = middle;
      }
      i = j;
    }
    if (bestLength * LEVEL_STEP < 0.12) {
      // No pause: the quietest 10 ms near the target.
      let quietest = Infinity;
      const near = Math.round((from + target) / LEVEL_STEP);
      for (let i = near; i < hi; i += 1) {
        const level = levels[i] ?? -Infinity;
        if (level < quietest) {
          quietest = level;
          cut = i;
        }
      }
    }
    const at = cut > 0 ? cut * LEVEL_STEP : from + target;
    clips.push({ start: from, end: at });
    from = at;
  }
  clips.push({ start: from, end: durationSec });
  return clips;
}

// ── Cues out ─────────────────────────────────────────────────────────────────

export interface CueOptions {
  style: CaptionStyle;
  /** Pauses shorter than this, seconds, are closed: the cue stays up until the next one. */
  closeGapsUnder: number;
  durationSec: number;
  /** The recording's levels every 10 ms, to put cue edges where the speech starts and stops. */
  levels?: Float32Array;
  /** Uzbek in Latin: the o' and g' apostrophe written one way throughout. */
  uzbekApostrophe?: 'typewriter' | 'official';
}

/** A cue's edges move at most this far to land on the speech, seconds. */
const SNAP_REACH = 0.25;
/** The cue shows this long before the voice starts after a pause, and stays this long after it stops. */
const LEAD = 0.04;
const LINGER = 0.3;
/** No cue is shorter than this, where there's room. */
const MIN_CUE = 0.4;

const SAME_LETTER = /['‘’`´ʻʼ]/g;

/**
 * Uzbek Latin's two apostrophes, written one way however they came: after o
 * and g (oʻ, gʻ) the turned comma, elsewhere (the tutuq belgisi, maʼno) the
 * apostrophe; with `typewriter`, both as the plain ' every font has.
 */
export function uzbekApostrophes(text: string, style: 'typewriter' | 'official'): string {
  if (style === 'typewriter') return text.replace(SAME_LETTER, "'");
  return text.replace(/([oOgG])['‘’`´ʻʼ]/g, '$1ʻ').replace(/([^oOgG\s])['‘’`´ʼ]/g, '$1ʼ');
}

function finishText(words: readonly TimedWord[], options: CueOptions): string {
  // Words are joined by single spaces: one before punctuation goes.
  let text = cueText(words)
    .replace(/ ([,.;:!?…])/g, '$1')
    .trim();
  if (options.style.bareEnds) text = trimEndOf(text, '.,;:…');
  if (options.uzbekApostrophe) text = uzbekApostrophes(text, options.uzbekApostrophe);
  return options.style.lines === 2 ? rewrap(text, options.style.lineChars) : text;
}

/**
 * The finished cues, in milliseconds: each from its first word to its last,
 * edges moved onto the speech where a pause is next to them, pauses under
 * `closeGapsUnder` closed (the cue stays until the next starts), longer ones
 * left open after a short linger, and no overlap.
 */
export function finishCues(cues: readonly WordCue[], options: CueOptions): Cue[] {
  const mask = options.levels ? speechMask(options.levels) : null;
  const timed = cues
    .filter((cue) => cue.words.length > 0)
    .map((cue) => ({
      start: cue.words[0]?.start ?? 0,
      end: cue.words[cue.words.length - 1]?.end ?? 0,
      text: finishText(cue.words, options),
    }))
    .filter((cue) => cue.text)
    .sort((a, b) => a.start - b.start);

  // Edges onto the speech: only where there's a pause next to them, since
  // inside continuous speech there's no edge to find.
  if (mask) {
    timed.forEach((cue, i) => {
      const before = timed[i - 1];
      const after = timed[i + 1];
      if (!before || cue.start - before.end >= 0.15) {
        const onset = nearestEdge(mask, cue.start, SNAP_REACH, true);
        if (onset !== null) cue.start = Math.max(before?.end ?? 0, onset - LEAD, 0);
      }
      if (!after || after.start - cue.end >= 0.15) {
        const offset = nearestEdge(mask, cue.end, SNAP_REACH, false);
        if (offset !== null && offset > cue.start) cue.end = offset;
      }
    });
  }

  const duration = options.durationSec;
  timed.forEach((cue, i) => {
    const next = timed[i + 1];
    cue.start = Math.min(Math.max(cue.start, 0), duration);
    if (next && next.start < cue.start) next.start = cue.start;
    const room = next ? next.start : duration;
    if (next && next.start - cue.end < options.closeGapsUnder) cue.end = next.start;
    else cue.end = Math.min(cue.end + LINGER, room);
    if (cue.end - cue.start < MIN_CUE) cue.end = Math.min(cue.start + MIN_CUE, room);
    cue.end = Math.min(cue.end, room);
  });
  return timed
    .map((cue) => ({
      start: Math.round(cue.start * 1000),
      end: Math.round(cue.end * 1000),
      text: cue.text,
    }))
    .filter((cue) => cue.end > cue.start);
}

// ── Asking ───────────────────────────────────────────────────────────────────

/** What Gemini is asked to return (structured output); short keys keep the reply small. */
export const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    cues: {
      type: 'array',
      description: 'Subtitle cues in spoken order.',
      items: {
        type: 'object',
        properties: {
          words: {
            type: 'array',
            description: 'The cue’s words in order, each with when it is spoken.',
            items: {
              type: 'object',
              properties: {
                w: {
                  type: 'string',
                  description: 'The word, with any punctuation that follows it.',
                },
                s: { type: 'number', description: 'Start, seconds from the start of the clip.' },
                e: { type: 'number', description: 'End, seconds from the start of the clip.' },
              },
              required: ['w', 's', 'e'],
            },
          },
        },
        required: ['words'],
      },
    },
  },
  required: ['cues'],
} as const;

export interface PromptOptions {
  style: CaptionStyle;
  /** null: detect it. */
  language: { name: string; script?: 'latin' | 'cyrillic' } | null;
  uzbekApostrophe: 'typewriter' | 'official';
  keepFillers: boolean;
  /** Names and terms to spell as given. */
  glossary: string;
  clip: { index: number; count: number; seconds: number };
  /** The last words of the clip before, so this one carries on without repeating them. */
  before: string;
}

/** The system instruction and the request for one clip. */
export function captionPrompt(options: PromptOptions): { system: string; user: string } {
  const { style, language, clip } = options;
  const apostrophe =
    options.uzbekApostrophe === 'official'
      ? 'oʻ and gʻ with the turned comma ʻ (U+02BB), and the tutuq belgisi as ʼ (U+02BC)'
      : "oʻ and gʻ typed as o' and g' with the plain apostrophe ', and the tutuq belgisi as ' too";
  const languageLine = language
    ? `The speech is in ${language.name}${
        language.script
          ? `; write it in the ${language.script === 'latin' ? 'Latin' : 'Cyrillic'} script`
          : ''
      }. Words from other languages are written as a native subtitler would.`
    : 'Detect the language. Write each language in its usual script; Uzbek in the Latin script.';
  const system = [
    'You are a professional subtitler and transcriber. You hear one clip of audio and return its subtitles as JSON.',
    'Accuracy comes first: write exactly the words spoken, never paraphrase, translate, summarise or correct the speaker.',
  ].join(' ');
  const rules = [
    languageLine,
    `Uzbek Latin spelling: ${apostrophe}.`,
    options.keepFillers
      ? 'Keep every sound as spoken, fillers and repeats included.'
      : 'Leave out filler sounds (eee, mmm, hmm, ah) and stutters; keep every real word.',
    'Add normal punctuation and capitalisation. Write numbers the way a subtitle would.',
    `Group the words into cues for ${style.lines === 1 ? 'one-line' : 'one- or two-line'} subtitles of ${String(style.minWords)} to ${String(style.maxWords)} words each.`,
    `Use fewer words, or ${String(style.maxWords + 1)} at most, only when that keeps a phrase whole.`,
    'Split only where meaning allows: every cue must read naturally on its own.',
    'Never separate a preposition or postposition from its word, an adjective or number from its noun, the parts of a name, a negation from its verb, or a verb from its auxiliary (Uzbek: "aytib berdi", "qilib qo‘ydi", "kelgan edi").',
    'Prefer breaks at punctuation, between clauses and where the speaker pauses. A cue never runs across the end of a sentence.',
    `For every word give "s" and "e": when it starts and ends, in seconds from the start of this clip, to 0.01 s. The clip is ${clip.seconds.toFixed(2)} s long; no time may be later.`,
    'Times follow the audio itself: increasing, words never overlap, and a word starts when its first sound starts. Music, noise and silence get no words.',
    'If nothing is spoken, return {"cues": []}.',
  ];
  if (options.glossary.trim()) {
    rules.push(`Names and terms that may come up, spelled this way: ${options.glossary.trim()}.`);
  }
  if (clip.count > 1) {
    rules.push(
      `This is part ${String(clip.index + 1)} of ${String(clip.count)} of a longer recording.` +
        (options.before
          ? ` The part before ended with: "${options.before}". Don't repeat those words.`
          : ''),
    );
  }
  const user = [
    'Transcribe the audio above into subtitle cues.',
    ...rules.map((rule) => `- ${rule}`),
    'Return JSON only: {"cues": [{"words": [{"w": "word", "s": 0.00, "e": 0.00}]}]}.',
  ].join('\n');
  return { system, user };
}

/** The last few words already transcribed, for the next clip's prompt. */
export function tailWords(cues: readonly WordCue[], count = 10): string {
  return cues
    .flatMap((cue) => cue.words.map((w) => w.text))
    .slice(-count)
    .join(' ');
}
