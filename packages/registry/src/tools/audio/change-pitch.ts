import { defineTool } from '../../define';

export default defineTool({
  id: 'change-pitch',
  code: 'A08',
  slug: 'change-pitch',
  category: 'audio',
  name: 'Change Speed & Pitch',
  tagline: 'Speed audio up without the chipmunk effect, or change pitch without changing tempo.',
  summary: 'Tempo in %, pitch in semitones and cents',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['mp3', 'wav', 'flac', 'm4a', 'ogg'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Change Pitch of Song, Up to 12 Semitones | EditToolbelt',
    description:
      'Transpose a song up or down by up to 12 semitones, speed audio up or slow it down without changing pitch, or change both together like a vinyl record.',
    h1: 'Change Pitch of Song',
    primaryQuery: 'change pitch of song',
    secondaryQueries: ['speed up audio', 'transpose audio', 'key changer'],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'Pick what to change: the tempo (the pitch stays), the pitch (the length stays), or both together like a record played faster or slower.',
      'Set the speed in %, or the pitch in semitones and cents.',
      'Apply, listen, and download in the same format or another.',
    ],
    faq: [
      {
        q: 'How does it keep the pitch when the tempo changes?',
        a: 'With a phase vocoder: the sound is cut into overlapping 85 ms slices, each one’s spectrum is laid down closer together or further apart, and every frequency keeps moving at its own rate. Tones stay in tune; very sharp hits can soften a little at big changes.',
      },
      {
        q: 'How far can I go?',
        a: 'Tempo from 25% to 400%, and pitch 12 semitones up or down, plus or minus 50 cents. Changes within about 20% and 3 semitones sound the most natural.',
      },
      {
        q: 'What is vinyl mode?',
        a: 'The audio is played faster or slower as it is, so the pitch moves with the speed, like a record or tape. At 200% it is twice as fast and an octave higher.',
      },
      {
        q: 'Is my file uploaded?',
        a: 'No. It is changed in this browser and never leaves your device.',
      },
    ],
  },
  related: ['bpm-key-finder', 'stem-splitter', 'video-speed'],
  willDo: [
    'Change tempo in % without changing pitch',
    'Shift pitch from -12 to +12 semitones, plus cents, without changing tempo',
    'Change tempo and pitch together, vinyl-style',
  ],
});
