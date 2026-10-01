import { defineTool } from '../../define';

export default defineTool({
  id: 'storage-calculator',
  code: 'T08',
  slug: 'storage-calculator',
  category: 'subtitles-time',
  name: 'Recording Storage Calculator',
  tagline: 'See how many hours of footage fit on a card or drive at a given codec bitrate.',
  summary: 'Hours of footage per card or drive',
  status: 'beta',
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
    howTo: [
      'Pick what you need: the hours that fit on a card or drive, or the space a shoot needs.',
      'Pick a camera codec for its typical bitrate, or type your camera’s own bitrate in Mbps.',
      'Enter the card or drive size in GB or TB, or the hours you plan to record.',
      'Read the recording time, or the storage needed with and without a backup copy.',
    ],
    faq: [
      {
        q: 'How many hours of 4K fit on 1 TB?',
        a: 'At 100 Mbps, typical for 4K H.264 on mirrorless cameras, about 22 hours. At ProRes 422 HQ in UHD (707 Mbps) it is about 3 hours 8 minutes.',
      },
      {
        q: 'Why does my 1 TB drive show 931 GB?',
        a: 'Drives are sold in decimal units (1 TB = 1,000,000,000,000 bytes); Windows counts in binary units and still writes GB. Nothing is missing. This calculator uses the decimal units on the label.',
      },
      {
        q: 'Are the codec bitrates exact?',
        a: 'No, they are typical values to start from. Your camera, its settings and the frame rate decide the real bitrate: check the manual and type it in.',
      },
    ],
  },
  related: ['bitrate-calculator', 'file-checksum', 'shutter-angle-calculator'],
  willDo: [
    'Work out hours of footage from card or drive size in GB or TB and codec bitrate in Mbps',
    'Go the other way: enter the hours you plan to shoot and get the storage you need',
    'Start from an editable table of typical bitrates for common camera codecs',
  ],
});
