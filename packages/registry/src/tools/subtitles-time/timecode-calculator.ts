import { defineTool } from '../../define';

export default defineTool({
  id: 'timecode-calculator',
  code: 'T04',
  slug: 'timecode-calculator',
  category: 'subtitles-time',
  name: 'Timecode Calculator',
  tagline: 'Add, subtract and convert timecodes, with exact 29.97 and 59.94 fps drop-frame math.',
  summary: 'Add, subtract and convert timecode',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile', 'panel'],
  seo: {
    title: 'Timecode Calculator, Drop Frame and NDF | EditToolbelt',
    description:
      'Add and subtract timecodes, convert between timecode, frames and seconds, or from one frame rate to another. Drop-frame math follows SMPTE 12M.',
    h1: 'Timecode Calculator',
    primaryQuery: 'timecode calculator',
    secondaryQueries: ['frames to timecode', 'drop frame timecode calculator'],
  },
  related: ['video-info', 'subtitle-shift', 'shutter-angle-calculator'],
  willDo: [
    'Add and subtract timecodes, and get the duration between two of them',
    'Convert between timecode, frames and seconds, and from one frame rate to another',
    'Work at 23.976, 24, 25, 29.97 DF and NDF, 30, 48, 50, 59.94 DF and NDF, 60 fps or a custom rate',
  ],
});
