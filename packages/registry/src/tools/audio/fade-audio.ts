import { defineTool } from '../../define';

export default defineTool({
  id: 'fade-audio',
  code: 'A07',
  slug: 'fade-audio',
  category: 'audio',
  name: 'Fade In / Fade Out',
  tagline: 'Add a fade in or fade out with a linear, exponential, logarithmic or S-curve shape.',
  summary: 'Set the length, pick one of 4 curves',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Fade In Fade Out Audio, Choose from 4 Curves | EditToolbelt',
    description:
      'Add a fade in or fade out to an MP3, WAV or other audio file. Set each length, pick a linear, exponential, logarithmic or S-curve, and preview it first.',
    h1: 'Fade In Fade Out Audio',
    primaryQuery: 'fade in fade out audio',
    secondaryQueries: ['add fade to mp3'],
  },
  related: ['trim-audio', 'merge-audio', 'normalize-audio'],
  willDo: [
    'Set how long the fade in and the fade out last',
    'Pick a curve for each: linear, exponential, logarithmic or S-curve',
    'Preview the fades before you download',
  ],
});
