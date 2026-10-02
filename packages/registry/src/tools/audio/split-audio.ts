import { defineTool } from '../../define';

export default defineTool({
  id: 'split-audio',
  code: 'A14',
  slug: 'split-audio',
  category: 'audio',
  name: 'Split Audio',
  tagline: 'Split one audio file into equal parts, by length, at silences or at markers.',
  summary: 'Equal parts, by length or at silences',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'timeline',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['zip'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Split MP3, by Length, Silence or Markers | EditToolbelt',
    description:
      'Cut an MP3 or other audio file into equal parts, pieces of a set length, or pieces at silences or markers. Download every part in one ZIP.',
    h1: 'Split MP3',
    primaryQuery: 'split mp3',
    secondaryQueries: [],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'Under Where to split, pick equal parts, pieces of a length, at the silences, or by hand.',
      'Check the parts on the timeline. Move an edge, drop a part, or add one before splitting.',
      'Press Split and download every part in one ZIP, named in order.',
    ],
    faq: [
      {
        q: 'Is my audio uploaded?',
        a: 'No. It is split in this browser and never leaves your device.',
      },
      {
        q: 'Does splitting lose quality?',
        a: 'No, when the format is kept. MP3, AAC and Opus parts are copied frame by frame, and WAV and FLAC are cut to the sample. Only a change of format encodes the audio again.',
      },
      {
        q: 'Where does it split at a silence?',
        a: 'In the middle of each pause at least as long as you set (1 s at first), so each part keeps half the pause at either end and nothing is lost. A silence at the very start or end stays with the first or last part.',
      },
    ],
  },
  related: ['trim-audio', 'remove-silence', 'merge-audio'],
  willDo: [
    'Split into equal parts, or into pieces of a set duration',
    'Split at silences, or at markers you place',
    'Download every part in one ZIP file',
  ],
});
