import { defineTool } from '../../define';
import { SPEECH_AUDIO } from '../audio/transcribe-audio';

export default defineTool({
  id: 'auto-subtitles',
  code: 'V17',
  slug: 'auto-subtitles',
  category: 'video',
  name: 'Auto Subtitles',
  tagline: 'Turn speech into timed SRT, VTT or ASS subtitles in 90+ languages, including Uzbek.',
  summary: 'Speech to SRT in 90+ languages',
  // An admin switches it on (status beta) in the server build, once Modal runs it.
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['video-ml-server'],
  ui: 'form',
  batch: false,
  // The page sends only the sound, taken out of the video in the browser; the API also takes video.
  accepts: [...SPEECH_AUDIO, 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['srt', 'vtt', 'ass', 'txt'],
  limits: {
    server: {
      free: { maxBytes: 500 * 1024 ** 2, maxDurationSec: 30 * 60 },
      paid: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
    timeoutSec: 70 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 2, minCredits: 2 },
  gpu: 'L4',
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Auto Subtitle Generator, SRT in 90+ Languages | EditToolbelt',
    description:
      'Get timed subtitles from speech in 90+ languages, including Uzbek, Russian and English. Only the audio is uploaded. Download SRT, VTT, ASS or TXT.',
    h1: 'Auto Subtitle Generator',
    primaryQuery: 'auto subtitle generator',
    secondaryQueries: ['generate subtitles from video', 'srt generator', 'uzbek subtitles'],
    howTo: [
      'Drop a video or an audio file. Your browser takes the sound out of a video, and only that is uploaded.',
      'Leave Language on Auto, or pick it. Turn on Translate to get English subtitles from any language.',
      'Set the line length and lines per subtitle, or keep 42 characters on 2 lines.',
      'Select Make subtitles on our servers, then download SRT, VTT, ASS or TXT.',
    ],
    faq: [
      {
        q: 'Why is only the audio uploaded?',
        a: 'Subtitles need only the speech. Your browser copies the sound out of the video, usually without re-encoding it, so a 1 GB video sends a few megabytes and the job starts sooner.',
      },
      {
        q: 'Does it do Uzbek?',
        a: 'Yes, along with Russian, English and about 100 other languages. It uses Whisper large-v3. Pick the language yourself when a video starts with music or mixes languages.',
      },
      {
        q: 'Can I burn the subtitles into the video?',
        a: 'Yes. Download the SRT or ASS here, then use Burn Subtitles with the same video. ASS keeps a clean white style with an outline.',
      },
      {
        q: 'What are word timestamps?',
        a: 'A time for every word, for captions that highlight each word as it is said. VTT gets timestamp tags and ASS gets karaoke timing; SRT has no place for them.',
      },
      {
        q: 'What does it cost?',
        a: '2 credits a minute, at least 2. A file with no speech fails without a charge. Your audio and the subtitles are deleted within an hour.',
      },
    ],
  },
  related: ['burn-subtitles', 'subtitle-converter', 'transcribe-audio'],
  willDo: [
    'Turn speech into SRT, VTT, ASS or TXT in 90+ languages, with optional translation to English',
    'Extract the audio in your browser and upload only that, which is faster and sends less data',
    'Set line length and lines per subtitle, with optional word timestamps',
  ],
});
