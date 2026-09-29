import { defineTool } from '../../define';

export default defineTool({
  id: 'storage-calculator',
  code: 'T08',
  slug: 'storage-calculator',
  category: 'subtitles-time',
  name: 'Recording Storage Calculator',
  tagline: 'See how many hours of footage fit on a card or drive at a given codec bitrate.',
  summary: 'Hours of footage per card or drive',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Video Storage Calculator, Hours per GB or TB | EditToolbelt',
    description:
      'Find how many hours of footage fit on a card or drive at a codec bitrate, or the storage a shoot needs. Starts from typical bitrates for common cameras.',
    h1: 'Video Storage Calculator',
    primaryQuery: 'video storage calculator',
    secondaryQueries: ['how many hours of 4k on 1tb'],
  },
  related: ['bitrate-calculator', 'file-checksum', 'shutter-angle-calculator'],
  willDo: [
    'Work out hours of footage from card or drive size in GB or TB and codec bitrate in Mbps',
    'Go the other way: enter the hours you plan to shoot and get the storage you need',
    'Start from an editable table of typical bitrates for common camera codecs',
  ],
});
