/**
 * T09 Subtitle Generator (tools/subtitles-and-time.md): subtitles from speech,
 * by Gemini with the person's own API key. The recording's levels are read
 * once (as Remove Silence reads them); a long one is cut into clips in its
 * pauses; each clip goes from the browser to Gemini as 16 kHz mono WAV, with
 * the last words of the clip before it, and comes back as words with times
 * grouped into cues by meaning. @etb/core then holds the cues to the style,
 * puts their edges on the speech, closes the short pauses and writes SRT.
 */
import {
  CaptionReplyError,
  captionLanguage,
  captionPrompt,
  captionStyle,
  CAPTION_SCHEMA,
  finishCues,
  fitStyle,
  offsetCues,
  planClips,
  readCaptionReply,
  repairClipTimes,
  tailWords,
  writeSrt,
  type Clip,
  type WordCue,
} from '@etb/core/subtitles';
import { WavOutputFormat, type Input, type InputAudioTrack } from 'mediabunny';

import { MEDIA_META } from '../media-meta';
import type { Engine, EngineOutput, RunContext } from '../types';
import { encodeAudio } from '../video/encode-audio';
import { MediaInputError, openInput } from '../video/media';
import { base64Of, GeminiClient, GeminiError, modelId } from './gemini';
import { levelsOf } from './silence';

export interface SubtitleGeneratorOptions {
  apiKey?: string;
  model?: string;
  /** instagram, phrase or youtube (CAPTION_STYLES). */
  style?: string;
  /** "auto" or a CAPTION_LANGUAGES value. */
  language?: string;
  /** typewriter or official: Uzbek's oʻ and gʻ. */
  apostrophe?: string;
  /** remove or keep. */
  fillers?: string;
  /** Pauses shorter than this many seconds are closed. */
  gaps?: string;
  /** Names and terms to spell as given. */
  glossary?: string;
}

/** Gemini's sample rate for audio; anything higher is wasted upload. */
const RATE = 16_000;
/** A clip that won't come back whole is split in two, down to this length. */
const SHORTEST_SPLIT = 15;

/**
 * The clip as 16-bit WAV, base64, for an inline part: built in everywhere, where
 * the FLAC encoder's worker crashes in WebKit. 110 s is 3.5 MB, far under
 * Gemini's 20 MB request limit.
 */
async function clipAudio(input: Input, track: InputAudioTrack, clip: Clip, signal: AbortSignal) {
  const out = await encodeAudio(
    {
      input,
      track,
      format: new WavOutputFormat(),
      codec: 'pcm-s16',
      sampleRate: RATE,
      numberOfChannels: 1,
      start: clip.start,
      end: clip.end,
    },
    signal,
    () => undefined,
  );
  return { mimeType: 'audio/wav', base64: base64Of(new Uint8Array(out.bytes)) };
}

/** Halves of a clip, cut at its quietest pause. */
function halves(levels: Float32Array, clip: Clip): Clip[] {
  const length = clip.end - clip.start;
  const step = 0.01;
  const own = levels.subarray(Math.round(clip.start / step), Math.round(clip.end / step));
  const half = length / 2;
  return planClips(own, length, { target: half, longest: half + 5, shortest: half / 2 }).map(
    (c) => ({
      start: clip.start + c.start,
      end: clip.start + c.end,
    }),
  );
}

export const subtitleGeneratorEngine: Engine<SubtitleGeneratorOptions> = {
  ...MEDIA_META.subtitleGenerator,
  async run(file, opts, ctx: RunContext): Promise<EngineOutput> {
    const apiKey = (opts.apiKey ?? '').trim();
    if (!apiKey) throw new MediaInputError('Paste your Gemini API key first');
    const style = captionStyle(opts.style);
    const language = captionLanguage(opts.language);
    const apostrophe = opts.apostrophe === 'official' ? 'official' : 'typewriter';
    const gaps = Number(opts.gaps);
    const model = modelId(opts.model);
    const gemini = new GeminiClient(apiKey, model);

    ctx.progress(0, 'Reading the audio');
    const { levels, duration } = await levelsOf(file);
    if (duration <= 0) throw new MediaInputError('This file has no sound to transcribe');
    const plan = planClips(levels, duration);

    const input = openInput(file);
    const cues: WordCue[] = [];
    let sentSeconds = 0;
    let parts = 0;
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) {
        throw new MediaInputError('This browser can’t decode the sound in this file');
      }

      const report = (stage: string) => {
        ctx.progress(0.05 + 0.9 * Math.min(1, sentSeconds / duration), stage, {
          step: `Part ${String(Math.min(parts + 1, plan.length))} of ${String(plan.length)}`,
        });
      };

      const transcribe = async (clip: Clip, index: number, count: number): Promise<void> => {
        const seconds = clip.end - clip.start;
        report('Preparing the audio');
        const audio = await clipAudio(input, track, clip, ctx.signal);
        const { system, user } = captionPrompt({
          style,
          language: language && {
            name: language.name,
            ...(language.script && { script: language.script }),
          },
          uzbekApostrophe: apostrophe,
          keepFillers: opts.fillers === 'keep',
          glossary: opts.glossary ?? '',
          clip: { index, count, seconds },
          before: tailWords(cues),
        });
        report('Gemini is listening');
        // No progress comes while Gemini works: tick through the clip's share at about
        // the pace a flash model goes (a few seconds per minute of speech).
        const from = sentSeconds;
        const started = performance.now();
        const ticker = setInterval(() => {
          const guess = Math.min(
            0.9,
            (performance.now() - started) / 1000 / Math.max(8, seconds * 0.25),
          );
          sentSeconds = from + seconds * guess;
          report('Gemini is listening');
        }, 400);
        let answer;
        try {
          answer = await gemini.generate({
            system,
            prompt: user,
            audio,
            schema: CAPTION_SCHEMA,
            signal: ctx.signal,
            onWait: (wait, why) => {
              report(`${why}; trying again in ${String(Math.round(wait))} s`);
            },
          });
        } finally {
          clearInterval(ticker);
          sentSeconds = from;
        }
        let words: WordCue[] | null = null;
        if (answer.finish !== 'MAX_TOKENS') {
          try {
            words = readCaptionReply(answer.text);
          } catch (error) {
            if (!(error instanceof CaptionReplyError)) throw error;
          }
        }
        if (!words) {
          // Cut off or garbled: a shorter clip makes a shorter answer.
          if (seconds < SHORTEST_SPLIT * 2) {
            throw new GeminiError(
              answer.finish === 'MAX_TOKENS'
                ? 'Gemini’s answer was cut off even for a short part'
                : 'Gemini’s answer wasn’t the subtitles it was asked for',
            );
          }
          for (const part of halves(levels, clip)) await transcribe(part, index, count);
          return;
        }
        cues.push(...offsetCues(repairClipTimes(words, seconds), clip.start));
        sentSeconds = from + seconds;
        parts += 1;
      };

      for (const [index, clip] of plan.entries()) {
        await transcribe(clip, index, plan.length);
      }
    } finally {
      input.dispose();
    }

    ctx.progress(0.97, 'Timing the cues');
    const out = finishCues(fitStyle(cues, style), {
      style,
      closeGapsUnder: Number.isFinite(gaps) && gaps >= 0 ? gaps : 1.5,
      durationSec: duration,
      levels,
      ...(language?.value === 'uz' && { uzbekApostrophe: apostrophe }),
    });
    if (out.length === 0) throw new MediaInputError('Gemini heard no speech in this file');
    const words = cues.reduce((n, cue) => n + cue.words.length, 0);
    return {
      blob: new Blob([writeSrt(out)], { type: 'application/x-subrip' }),
      ext: 'srt',
      path: `Gemini · ${model}`,
      durationSec: duration,
      details: [
        { label: 'Cues', value: String(out.length) },
        { label: 'Words', value: String(words) },
        { label: 'Parts sent', value: String(parts) },
      ],
    };
  },
};
