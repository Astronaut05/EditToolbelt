import { defineTool } from '../../define';

export default defineTool({
  id: 'audio-channels',
  code: 'A13',
  slug: 'audio-channels',
  category: 'audio',
  name: 'Audio Channel Tools',
  tagline: 'Turn stereo into mono, fix audio that plays in one ear, or swap and split channels.',
  summary: 'Mono, stereo, swap, split, fix one side',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'zip'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Stereo to Mono, Fix Audio in One Ear | EditToolbelt',
    description:
      'Mix stereo to mono or keep one side, copy a one-sided lav mic to both ears, swap or split channels, invert the phase of one channel and spot dual-mono.',
    h1: 'Stereo to Mono',
    primaryQuery: 'stereo to mono',
    secondaryQueries: ['fix audio only in one ear', 'split stereo channels'],
    howTo: [
      'Drop an audio file. A stereo file is checked as it arrives: one silent side, the same sound on both, or one side inverted.',
      'The fix is picked for you when there is one; or choose what to do: mono, one side on both, swap, invert, split or mono to stereo.',
      'Keep the format, or pick another.',
      'Apply it and download the file, or a ZIP of the two sides when you split.',
    ],
    faq: [
      {
        q: 'Why does my audio play in only one ear?',
        a: 'A lav or a single mic recorded into one input of a stereo recorder or camera leaves the other side empty. Choose left (or right) on both sides: the recorded side is copied to the empty one.',
      },
      {
        q: 'Mixed mono or one side?',
        a: 'Mixed adds left and right at half each, so nothing clips. If one side is noise or another mic you don’t want, take the other side alone instead.',
      },
      {
        q: 'What is dual-mono?',
        a: 'A mono recording stored as stereo: both sides the same. It sounds the same as mono and takes twice the room, so it is worth turning into mono.',
      },
      {
        q: 'When should I invert a channel?',
        a: 'When one side is the other upside down, which happens with a miswired cable. It sounds hollow in stereo and almost silent in mono. Inverting one side fixes both.',
      },
    ],
  },
  related: ['extract-audio', 'replace-audio', 'loudness-meter'],
  willDo: [
    'Turn stereo into mono by summing or picking L or R, or turn mono into stereo',
    'Fix one-sided lav audio by copying L to both channels',
    'Swap L and R, split stereo into two mono files, invert the phase of one channel, and detect dual-mono',
  ],
});
