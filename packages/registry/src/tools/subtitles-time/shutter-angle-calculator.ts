import { defineTool } from '../../define';

export default defineTool({
  id: 'shutter-angle-calculator',
  code: 'T07',
  slug: 'shutter-angle-calculator',
  category: 'subtitles-time',
  name: 'Shutter Angle Calculator',
  tagline: 'Convert shutter angle to shutter speed at your frame rate: 180° at 24 fps is 1/48 s.',
  summary: 'Angle to speed, and flicker-safe speeds',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: '180 Degree Shutter Rule Calculator, Any fps | EditToolbelt',
    description:
      'Convert shutter angle to shutter speed and back at any frame rate, check the 180° rule, and find flicker-safe speeds under 50 Hz and 60 Hz mains lighting.',
    h1: '180 Degree Shutter Rule Calculator',
    primaryQuery: '180 degree shutter rule calculator',
    secondaryQueries: [],
  },
  related: ['timecode-calculator', 'storage-calculator', 'video-info'],
  willDo: [
    'Convert shutter angle to shutter speed and back at any frame rate',
    'Show the shutter speed that follows the 180° rule for your frame rate',
    'List flicker-safe shutter speeds for 50 Hz and 60 Hz mains lighting',
  ],
});
