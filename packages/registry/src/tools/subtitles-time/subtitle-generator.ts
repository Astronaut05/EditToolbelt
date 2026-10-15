import { defineTool } from '../../define';

/**
 * T09: subtitles from speech by Gemini, with the person's own API key, from
 * their browser to Google (docs/decisions/2026-10-15-subtitles-with-gemini.md).
 * Free here: Google bills the key's owner, if at all.
 */
export default defineTool({
  id: 'subtitle-generator',
  code: 'T09',
  slug: 'subtitle-generator',
  category: 'subtitles-time',
  name: 'Subtitle Generator',
  tagline: 'Accurate SRT subtitles from speech, split by meaning, timed to the voice.',
  summary: 'Speech to SRT, by Gemini',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['speech-gemini', 'audio-dsp'],
  ui: 'form',
  batch: false,
  accepts: [
    'audio/*',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.flac',
    '.ogg',
    '.opus',
    '.mp4',
    '.mov',
    '.m4v',
    '.webm',
    '.mkv',
  ],
  outputs: ['srt'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 2 * 60 * 60 } },
  cost: { kind: 'free' },
  sendsTo: 'Google Gemini',
  surfaces: ['web'],
  seo: {
    title: 'Subtitle Generator: Speech to SRT, Uzbek and More | EditToolbelt',
    description:
      'Make accurate SRT subtitles from a video or audio file with Gemini: short one-line captions for Reels, split by meaning, timed to the voice, no gaps.',
    h1: 'Subtitle Generator',
    primaryQuery: 'subtitle generator',
    secondaryQueries: [
      'auto subtitles uzbek',
      'srt generator from audio',
      'instagram captions srt',
    ],
    howTo: [
      'Paste your Gemini API key (free from Google AI Studio). Tick Remember to keep it on this device.',
      'Drop a video or a recording: MP4, MOV, MP3, WAV, M4A and more.',
      'Leave Style on Instagram for 2 to 4 words on one line, or pick a longer line or classic two-line subtitles.',
      'Pick the language if you know it, add names Gemini should spell your way, then select Generate subtitles.',
      'Check the preview and download the SRT for Premiere, CapCut, DaVinci Resolve or YouTube.',
    ],
    faq: [
      {
        q: 'Where does my audio go?',
        a: 'From your browser straight to Google’s Gemini API, with your key, never to our servers. We don’t see the audio, the text or the key. On Gemini’s free tier Google may use what you send to improve its products; on a paid key it doesn’t.',
      },
      {
        q: 'How is it split into lines?',
        a: 'Gemini groups the words by meaning: a name, a number and its noun, or a verb and its helper stay together, and breaks fall at punctuation and pauses. Then each cue is held to the style: Instagram is 2 to 4 words on one line, one word more only to keep a phrase whole.',
      },
      {
        q: 'Why are there no gaps between the subtitles?',
        a: 'A short pause doesn’t blank the screen: each cue stays up until the next one starts. Only a pause longer than the Close gaps setting, 1.5 s unless you change it, leaves the screen empty, a moment after the voice stops.',
      },
      {
        q: 'How accurate are the times?',
        a: 'Gemini times every word, and a long file goes in parts cut at pauses so the times can’t drift. Where a cue starts or ends at a pause, its edge moves onto the moment the voice starts or stops, measured from the audio itself.',
      },
      {
        q: 'Which languages work?',
        a: 'Uzbek in Latin or Cyrillic script, Russian, English and most other languages Gemini knows. Auto detects it. For Uzbek, choose how oʻ and gʻ are written: the plain apostrophe every font has, or the official ʻ.',
      },
      {
        q: 'What does it cost?',
        a: 'Nothing here. Any charge is Google’s, to your key, at Gemini’s prices. Google’s free tier has daily limits and no charge.',
      },
    ],
  },
  related: ['subtitle-converter', 'subtitle-shift', 'burn-subtitles', 'subtitle-editor'],
  willDo: [
    'Turn speech in a video or recording into SRT subtitles',
    'Split lines by meaning, 2 to 4 words for Reels or classic two-line subtitles',
    'Time every cue to the voice, with no gaps between cues',
  ],
});
