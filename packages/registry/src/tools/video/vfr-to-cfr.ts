import { defineTool } from '../../define';

export default defineTool({
  id: 'vfr-to-cfr',
  code: 'V15',
  slug: 'vfr-to-cfr',
  category: 'video',
  name: 'VFR to CFR',
  tagline: 'Convert variable frame rate phone and screen recordings to constant, so they stay in sync.',
  summary: 'Keep phone footage in sync in Premiere',
  status: 'soon',
  wave: 2,
  runtime: 'server-cpu',
  engines: ['video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'panel', 'api'],
  seo: {
    title: 'Convert Variable Frame Rate to Constant, Fix Sync | EditToolbelt',
    description:
      'Turn variable frame rate phone and screen recordings into constant frame rate, so audio stays in sync in Premiere and Resolve. Already CFR? No charge.',
    h1: 'Convert Variable Frame Rate to Constant',
    primaryQuery: 'convert variable frame rate to constant',
    secondaryQueries: ['vfr to cfr', 'fix audio sync premiere phone video'],
  },
  related: ['video-info', 'merge-videos', 'timecode-calculator'],
  willDo: [
    'Convert to the nearest standard rate (23.976 to 60 fps) automatically, or pick one yourself',
    'Encode visually lossless by default, and keep or drop the audio',
    'Check the file first, and do nothing and charge nothing if it is already constant',
  ],
});
