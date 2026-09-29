import { defineTool } from '../../define';

export default defineTool({
  id: 'split-audio',
  code: 'A14',
  slug: 'split-audio',
  category: 'audio',
  name: 'Split Audio',
  tagline: 'Split one audio file into equal parts, by length, at silences or at markers.',
  summary: 'Equal parts, by length or at silences',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Split MP3, by Length, Silence or Markers | EditToolbelt',
    description:
      'Cut an MP3 or other audio file into equal parts, pieces of a set length, or pieces at silences or markers. Download every part in one ZIP.',
    h1: 'Split MP3',
    primaryQuery: 'split mp3',
    secondaryQueries: [],
  },
  related: ['trim-audio', 'remove-silence', 'merge-audio'],
  willDo: [
    'Split into equal parts, or into pieces of a set duration',
    'Split at silences, or at markers you place',
    'Download every part in one ZIP file',
  ],
});
