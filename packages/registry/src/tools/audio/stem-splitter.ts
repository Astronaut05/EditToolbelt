import { defineTool } from '../../define';

export default defineTool({
  id: 'stem-splitter',
  code: 'A09',
  slug: 'stem-splitter',
  category: 'audio',
  name: 'Stem Splitter',
  tagline: 'Split a song into vocals, drums, bass and other, or into vocals and instrumental.',
  summary: 'Vocals, drums, bass, other',
  status: 'soon',
  wave: 2,
  runtime: 'server-gpu',
  engines: ['audio-ml-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 3, minCredits: 3 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Vocal Remover, Split Songs into 2 or 4 Stems | EditToolbelt',
    description:
      'Separate vocals from music for karaoke, or split a song into vocals, drums, bass and other with AI. Hear a free 20-second preview before you use credits.',
    h1: 'Vocal Remover',
    primaryQuery: 'vocal remover',
    secondaryQueries: ['stem splitter', 'separate vocals from music', 'remove vocals from song'],
  },
  related: ['change-pitch', 'bpm-key-finder', 'merge-audio'],
  willDo: [
    'Split into 2 stems (vocals, instrumental) or 4 stems (vocals, drums, bass, other)',
    'Hear a free 20-second preview of the stems before you use credits',
    'Download the stems as WAV or MP3, at Standard or High quality',
  ],
});
