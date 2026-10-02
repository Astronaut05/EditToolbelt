import { defineTool } from '../../define';

export default defineTool({
  id: 'merge-audio',
  code: 'A04',
  slug: 'merge-audio',
  category: 'audio',
  name: 'Merge Audio',
  tagline: 'Join audio files in order with crossfades or gaps, or mix tracks together.',
  summary: 'Join in order, or mix tracks',
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
  surfaces: ['web'],
  seo: {
    title: 'Merge Audio Files, Join with Crossfades | EditToolbelt',
    description:
      'Combine MP3, WAV and other audio files in the order you set, with a gap or crossfade at each join, or layer tracks into one mix that does not clip.',
    h1: 'Merge Audio Files',
    primaryQuery: 'merge audio files',
    secondaryQueries: ['combine mp3 files', 'join audio'],
    howTo: [
      'Drop two or more audio files: MP3, WAV, FLAC, OGG or M4A. Add more with Add files.',
      'Put them in order with the arrows, or remove one.',
      'Join them back to back, with a crossfade or a gap at each join, or mix them on top of each other.',
      'Normalize the result to a loudness target if you want, pick the format, and merge.',
    ],
    faq: [
      {
        q: 'Can I merge files with different sample rates or formats?',
        a: 'Yes. Files that share a sample rate keep it, so WAV and FLAC stay lossless. Otherwise every file is brought to 48 kHz first. Mono and stereo can be mixed; the result is stereo if any file is.',
      },
      {
        q: 'How does the crossfade sound?',
        a: 'It is equal-power: the outgoing file fades on a cosine and the incoming one on a sine, so the level holds steady through the join. Each crossfade shortens the result by its length: three 10 s files with 1 s crossfades make 28 s.',
      },
      {
        q: 'Will a mix clip?',
        a: 'No. The mix is measured first, and if its peak would go over −1 dBFS the whole mix is lowered just enough. The notes say by how much.',
      },
      {
        q: 'Are my files uploaded?',
        a: 'No. They are decoded and joined in this browser and never leave your device.',
      },
    ],
  },
  related: ['trim-audio', 'fade-audio', 'normalize-audio'],
  willDo: [
    'Join files in the order you set, with a gap or crossfade at each join',
    'Mix tracks on top of each other, lowered just enough not to clip',
    'Normalize the result if you want, and export to the format you choose',
  ],
});
