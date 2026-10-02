import { defineTool } from '../../define';

/** Audio types the jobs API takes for transcription (A12) and auto subtitles (V17). */
export const SPEECH_AUDIO = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
];

export default defineTool({
  id: 'transcribe-audio',
  code: 'A12',
  slug: 'transcribe-audio',
  category: 'audio',
  name: 'Transcribe Audio',
  tagline: 'Turn speech into text with timestamps, as TXT, SRT, VTT or JSON.',
  summary: 'Text, SRT or VTT with timestamps',
  // An admin switches it on (status beta) in the server build, once Modal runs it.
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['audio-ml-server'],
  ui: 'form',
  batch: false,
  accepts: SPEECH_AUDIO,
  outputs: ['txt', 'srt', 'vtt', 'json'],
  limits: {
    server: {
      free: { maxBytes: 500 * 1024 ** 2, maxDurationSec: 30 * 60 },
      paid: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
    // The GPU function stops at 65 min (4 h of speech takes well under that).
    timeoutSec: 70 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 2, minCredits: 2 },
  gpu: 'L4',
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Transcribe Audio to Text, with Timestamps | EditToolbelt',
    description:
      'Turn speech in an MP3, WAV or other audio file into text in Uzbek, Russian, English and more. Download TXT, SRT, VTT, or JSON with the time of every word.',
    h1: 'Transcribe Audio to Text',
    primaryQuery: 'transcribe audio to text',
    secondaryQueries: ['audio to text uzbek', 'mp3 to text'],
    howTo: [
      'Drop an audio file: MP3, WAV, M4A, FLAC, OGG or WebM.',
      'Leave Language on Auto, or pick it if you know it: Uzbek, Russian, English and 97 more.',
      'Pick TXT for plain text, SRT or VTT for timed lines, or JSON for every word with its time.',
      'Select Transcribe on our servers and download the text.',
    ],
    faq: [
      {
        q: 'Which languages does it understand?',
        a: 'About 100, including Uzbek, Russian, English, Kazakh, Turkish and Tajik. Auto detects the language from the first 30 seconds; pick it yourself when a recording starts with music or mixes languages.',
      },
      {
        q: 'How accurate is it?',
        a: 'It uses Whisper large-v3, among the most accurate open speech models. Clear speech with little background noise comes out nearly word for word; names and rare terms may need a fix.',
      },
      {
        q: 'What is in the JSON?',
        a: 'The detected language and every sentence with its start and end, and inside each, every word with its own start and end in seconds. Handy for editing tools and search.',
      },
      {
        q: 'What does it cost?',
        a: '2 credits a minute of audio, at least 2. A file with no speech in it fails without a charge. Your file and the text are deleted within an hour.',
      },
    ],
  },
  related: ['auto-subtitles', 'subtitle-converter', 'remove-noise'],
  willDo: [
    'Turn speech into text in languages including Uzbek, Russian and English',
    'Download plain TXT, or SRT and VTT subtitles with timestamps',
    'Get JSON with a timestamp for every word',
  ],
});
