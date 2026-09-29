import { defineTool } from '../../define';

export default defineTool({
  id: 'transcribe-audio',
  code: 'A12',
  slug: 'transcribe-audio',
  category: 'audio',
  name: 'Transcribe Audio',
  tagline: 'Turn speech into text with timestamps, as TXT, SRT, VTT or JSON.',
  summary: 'Text, SRT or VTT with timestamps',
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['audio-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 2, minCredits: 2 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Transcribe Audio to Text, with Timestamps | EditToolbelt',
    description:
      'Turn speech in an MP3, WAV or other audio file into text in Uzbek, Russian, English and more. Download TXT, SRT, VTT, or JSON with the time of every word.',
    h1: 'Transcribe Audio to Text',
    primaryQuery: 'transcribe audio to text',
    secondaryQueries: ['audio to text uzbek', 'mp3 to text'],
  },
  related: ['auto-subtitles', 'subtitle-converter', 'remove-noise'],
  willDo: [
    'Turn speech into text in languages including Uzbek, Russian and English',
    'Download plain TXT, or SRT and VTT subtitles with timestamps',
    'Get JSON with a timestamp for every word',
  ],
});
