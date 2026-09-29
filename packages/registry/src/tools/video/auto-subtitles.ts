import { defineTool } from '../../define';

export default defineTool({
  id: 'auto-subtitles',
  code: 'V17',
  slug: 'auto-subtitles',
  category: 'video',
  name: 'Auto Subtitles',
  tagline: 'Turn speech into timed SRT, VTT or ASS subtitles in 90+ languages, including Uzbek.',
  summary: 'Speech to SRT in 90+ languages',
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['video-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 2, minCredits: 2 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Auto Subtitle Generator, SRT in 90+ Languages | EditToolbelt',
    description:
      'Get timed subtitles from speech in 90+ languages, including Uzbek, Russian and English. Only the audio is uploaded. Fix words, then download SRT or VTT.',
    h1: 'Auto Subtitle Generator',
    primaryQuery: 'auto subtitle generator',
    secondaryQueries: ['generate subtitles from video', 'srt generator', 'uzbek subtitles'],
  },
  related: ['burn-subtitles', 'subtitle-converter', 'transcribe-audio'],
  willDo: [
    'Turn speech into SRT, VTT, ASS or TXT in 90+ languages, with optional translation to English',
    'Extract the audio in your browser and upload only that, which is faster and sends less data',
    'Fix words in a cue editor before download, or send the subtitles to Burn Subtitles',
  ],
});
