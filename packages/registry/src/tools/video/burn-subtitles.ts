import { defineTool } from '../../define';

export default defineTool({
  id: 'burn-subtitles',
  code: 'V16',
  slug: 'burn-subtitles',
  category: 'video',
  name: 'Burn Subtitles into Video',
  tagline: 'Hardcode SRT, VTT or ASS subtitles into the picture with your font, size and color.',
  summary: 'Hardsub SRT, VTT or ASS with your style',
  status: 'soon',
  wave: 2,
  runtime: 'server-cpu',
  engines: ['video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  // The video, and the subtitle file beside it (the `subtitles` option).
  accepts: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'application/x-subrip',
    'text/vtt',
    'text/x-ssa',
  ],
  outputs: ['mp4'],
  limits: {
    // Off until an admin sets its status: it needs the server build and a worker.
    server: {
      free: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 },
      paid: { maxBytes: 10 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
    timeoutSec: 2 * 60 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 1, minCredits: 2 },
  surfaces: ['web', 'api'],
  seo: {
    title: 'Burn Subtitles into Video, SRT, VTT or ASS | EditToolbelt',
    description:
      'Hardcode SRT, VTT or ASS subtitles into your video. Set font, size, color, outline, background box and position, and ASS styles are kept. Uses credits.',
    h1: 'Burn Subtitles into Video',
    primaryQuery: 'burn subtitles into video',
    secondaryQueries: ['add subtitles to video permanently', 'hardcode srt'],
    howTo: [
      'Drop the video: MP4, MOV, WebM or MKV.',
      'Choose the subtitle file: SRT, VTT or ASS.',
      'Pick the font, size, color and position, or keep the defaults: white with a thin outline at the bottom.',
      'Select Burn on our servers and download the MP4.',
    ],
    faq: [
      {
        q: 'What is the difference between burned and soft subtitles?',
        a: 'Burned subtitles are part of the picture, so they show everywhere: Instagram, TikTok, WhatsApp, any player. Soft subtitles are a separate track that viewers switch on, and many apps ignore them.',
      },
      {
        q: 'Does it work with Cyrillic and other alphabets?',
        a: 'Yes. The fonts cover Latin, Cyrillic and Greek. Subtitle files saved in older encodings, such as Windows-1251 for Russian, are read correctly too.',
      },
      {
        q: 'Are the styles in my ASS file kept?',
        a: 'Yes. An ASS file keeps its own fonts, colors and positions as written; the style settings here apply to SRT and VTT files.',
      },
      {
        q: 'Will the video lose quality?',
        a: 'The picture has to be re-encoded to draw the text into it. It is saved as H.264 at a high quality setting, and the sound is copied as it is when it can be.',
      },
    ],
  },
  related: ['auto-subtitles', 'subtitle-converter', 'subtitle-shift'],
  willDo: [
    'Burn SRT, VTT or ASS subtitles into the picture, or take them straight from Auto Subtitles',
    'Set font, size, color, outline, background box, position and max width',
    'Keep ASS styles as written, with bundled fonts that cover Cyrillic',
  ],
});
