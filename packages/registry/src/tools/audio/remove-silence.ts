import { defineTool } from '../../define';

export default defineTool({
  id: 'remove-silence',
  code: 'A11',
  slug: 'remove-silence',
  category: 'audio',
  name: 'Remove Silence',
  tagline: 'Cut or shorten the pauses in voiceovers, podcasts and lectures, and export the cuts.',
  summary: 'Cut pauses, export a cut list',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Remove Silence from Audio, Auto Cut Pauses | EditToolbelt',
    description:
      'Find the silent pauses in a voiceover or podcast, then remove or shorten them. Export the cuts as a CSV marker list to make the same edit in your video.',
    h1: 'Remove Silence from Audio',
    primaryQuery: 'remove silence from audio',
    secondaryQueries: ['cut silence podcast', 'auto cut silences'],
  },
  related: ['remove-noise', 'normalize-audio', 'trim-audio'],
  willDo: [
    'Find silences below a dBFS threshold, or set the threshold from the noise floor',
    'Remove each pause or shorten it to a length you set, and turn single cuts on or off',
    'Export the cuts as a CSV marker list to make the same edit in your video',
  ],
});
