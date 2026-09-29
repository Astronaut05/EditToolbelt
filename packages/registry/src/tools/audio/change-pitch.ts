import { defineTool } from '../../define';

export default defineTool({
  id: 'change-pitch',
  code: 'A08',
  slug: 'change-pitch',
  category: 'audio',
  name: 'Change Speed & Pitch',
  tagline: 'Speed audio up without the chipmunk effect, or change pitch without changing tempo.',
  summary: 'Tempo in %, pitch in semitones and cents',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Change Pitch of Song, Up to 12 Semitones | EditToolbelt',
    description:
      'Transpose a song up or down by up to 12 semitones, speed audio up or slow it down without changing pitch, or change both together like a vinyl record.',
    h1: 'Change Pitch of Song',
    primaryQuery: 'change pitch of song',
    secondaryQueries: ['speed up audio', 'transpose audio', 'key changer'],
  },
  related: ['bpm-key-finder', 'stem-splitter', 'video-speed'],
  willDo: [
    'Change tempo in % without changing pitch',
    'Shift pitch from -12 to +12 semitones, plus cents, without changing tempo',
    'Change tempo and pitch together, vinyl-style',
  ],
});
