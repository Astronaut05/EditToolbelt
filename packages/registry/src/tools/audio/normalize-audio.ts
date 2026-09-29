import { defineTool } from '../../define';

export default defineTool({
  id: 'normalize-audio',
  code: 'A05',
  slug: 'normalize-audio',
  category: 'audio',
  name: 'Normalize Loudness',
  tagline: 'Hit a loudness target like -14 LUFS for YouTube, with a -1 dBTP true-peak ceiling.',
  summary: 'Hit -14, -16, -23 or -24 LUFS',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Normalize Audio, Hit -14 LUFS or Any Target | EditToolbelt',
    description:
      'Set integrated loudness to -14 LUFS for YouTube, -16 LUFS for podcasts, -23 LUFS for EBU R128 or your own target, with true peak under -1 dBTP by default.',
    h1: 'Normalize Audio',
    primaryQuery: 'normalize audio',
    secondaryQueries: ['lufs normalizer', 'normalize to -14 lufs', 'make audio louder'],
  },
  related: ['loudness-meter', 'remove-noise', 'audio-converter'],
  willDo: [
    'Presets for streaming -14 LUFS, podcasts -16 LUFS, EBU R128 -23 LUFS and US film/TV -24 LKFS',
    'Measure with ITU-R BS.1770 gating, then apply gain only, or gain plus a true-peak limiter',
    'Keep true peak under the ceiling you set, -1 dBTP by default',
  ],
});
