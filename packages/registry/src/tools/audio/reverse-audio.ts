import { defineTool } from '../../define';

export default defineTool({
  id: 'reverse-audio',
  code: 'A15',
  slug: 'reverse-audio',
  category: 'audio',
  name: 'Reverse Audio',
  tagline: 'Play a sound backwards: reverse the whole file or only the part you select.',
  summary: 'Whole file or a selection',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Reverse Audio, Whole File or a Selection | EditToolbelt',
    description:
      'Play audio backwards. Reverse a whole MP3, WAV or other file, or select a part on the waveform and reverse only that. Free, in your browser.',
    h1: 'Reverse Audio',
    primaryQuery: 'reverse audio',
    secondaryQueries: [],
  },
  related: ['reverse-video', 'trim-audio', 'change-pitch'],
  willDo: [
    'Reverse a whole audio file so it plays backwards',
    'Select a part on the waveform and reverse only that',
    'Keep the original format, or export to another one',
  ],
});
