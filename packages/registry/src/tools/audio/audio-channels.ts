import { defineTool } from '../../define';

export default defineTool({
  id: 'audio-channels',
  code: 'A13',
  slug: 'audio-channels',
  category: 'audio',
  name: 'Audio Channel Tools',
  tagline: 'Turn stereo into mono, fix audio that plays in one ear, or swap and split channels.',
  summary: 'Mono, stereo, swap, split, fix one side',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Stereo to Mono, Fix Audio in One Ear | EditToolbelt',
    description:
      'Mix stereo to mono or keep one side, copy a one-sided lav mic to both ears, swap or split channels, invert the phase of one channel and spot dual-mono.',
    h1: 'Stereo to Mono',
    primaryQuery: 'stereo to mono',
    secondaryQueries: ['fix audio only in one ear', 'split stereo channels'],
  },
  related: ['extract-audio', 'replace-audio', 'loudness-meter'],
  willDo: [
    'Turn stereo into mono by summing or picking L or R, or turn mono into stereo',
    'Fix one-sided lav audio by copying L to both channels',
    'Swap L and R, split stereo into two mono files, invert the phase of one channel, and detect dual-mono',
  ],
});
