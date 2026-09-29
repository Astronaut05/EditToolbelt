import { defineTool } from '../../define';

export default defineTool({
  id: 'loudness-meter',
  code: 'A06',
  slug: 'loudness-meter',
  category: 'audio',
  name: 'Loudness Meter',
  tagline: 'Measure integrated LUFS, true peak and loudness range, and check platform targets.',
  summary: 'LUFS, true peak, LRA, pass or fail',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'analyzer',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'LUFS Meter Online, Check True Peak and LRA | EditToolbelt',
    description:
      'Read integrated, short-term and momentary LUFS, loudness range, true peak and RMS of your audio, with pass or fail against platform loudness targets.',
    h1: 'LUFS Meter Online',
    primaryQuery: 'lufs meter online',
    secondaryQueries: ['check audio loudness', 'true peak meter'],
  },
  related: ['normalize-audio', 'extract-audio', 'remove-noise'],
  willDo: [
    'Read integrated LUFS, short-term max, momentary max, loudness range, true peak and RMS',
    'See pass or fail against the loudness targets of each platform',
    'Follow loudness over time on a graph to find the loud and quiet parts',
  ],
});
