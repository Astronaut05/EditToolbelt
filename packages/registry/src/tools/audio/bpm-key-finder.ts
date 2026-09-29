import { defineTool } from '../../define';

export default defineTool({
  id: 'bpm-key-finder',
  code: 'A03',
  slug: 'bpm-key-finder',
  category: 'audio',
  name: 'BPM & Key Finder',
  tagline: "Find a song's BPM and key, with Camelot notation, plus tap tempo and a metronome.",
  summary: 'Tempo, key, Camelot, tap tempo',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'analyzer',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'BPM Finder, Get Tempo and Key in Seconds | EditToolbelt',
    description:
      'Drop a song to get its tempo in BPM and its key in Camelot notation, each with a confidence score. Tap tempo, a metronome and beat marker export included.',
    h1: 'BPM Finder',
    primaryQuery: 'bpm finder',
    secondaryQueries: [
      'find key of song',
      'song key and bpm finder',
      'tap tempo',
      'online metronome',
    ],
  },
  related: ['change-pitch', 'stem-splitter', 'trim-audio'],
  willDo: [
    'Detect BPM and musical key with a confidence score, in under 2 s for a 4-minute song on desktop',
    'Show the key in Camelot notation for DJs, and half or double tempo alternatives',
    'Tap tempo, run a metronome, and export beat markers as CSV or TXT to cut to the beat',
  ],
});
