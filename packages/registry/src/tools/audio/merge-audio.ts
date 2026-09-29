import { defineTool } from '../../define';

export default defineTool({
  id: 'merge-audio',
  code: 'A04',
  slug: 'merge-audio',
  category: 'audio',
  name: 'Merge Audio',
  tagline: 'Join audio files in order with crossfades, or mix tracks together with levels.',
  summary: 'Join in order, or mix tracks',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'batch',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Merge Audio Files, Join with Crossfades | EditToolbelt',
    description:
      'Combine MP3, WAV and other audio files in the order you set, with a gap or crossfade at each join, or layer tracks into one mix that does not clip.',
    h1: 'Merge Audio Files',
    primaryQuery: 'merge audio files',
    secondaryQueries: ['combine mp3 files', 'join audio'],
  },
  related: ['trim-audio', 'fade-audio', 'normalize-audio'],
  willDo: [
    'Join files in the order you set, with a gap or crossfade at each join',
    'Mix tracks on top of each other with a level per track, auto-gained so nothing clips',
    'Normalize the result if you want, and export to the format you choose',
  ],
});
