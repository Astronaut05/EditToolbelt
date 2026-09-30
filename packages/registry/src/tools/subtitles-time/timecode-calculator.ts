import { defineTool } from '../../define';

export default defineTool({
  id: 'timecode-calculator',
  code: 'T04',
  slug: 'timecode-calculator',
  category: 'subtitles-time',
  name: 'Timecode Calculator',
  tagline: 'Add, subtract and convert timecodes, with exact 29.97 and 59.94 fps drop-frame math.',
  summary: 'Add, subtract and convert timecode',
  status: 'live',
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
    howTo: [
      'Pick what to calculate: convert, add or subtract, the duration between two timecodes, or a new frame rate.',
      'Choose the frame rate. At 29.97 and 59.94 fps, pick DF or NDF to match your timeline.',
      'Type timecodes as HH:MM:SS:FF, with a semicolon before the frames for drop-frame.',
      'Read the result on the right. Copy any value, or copy the link to share the whole calculation.',
    ],
    faq: [
      {
        q: 'What is drop-frame timecode?',
        a: 'At 29.97 fps, non-drop timecode runs 3.6 seconds slow per hour. Drop-frame skips the frame numbers 00 and 01 at the start of every minute except minutes 00, 10, 20, 30, 40 and 50, so the timecode keeps up with the clock. No video frames are dropped, only numbers.',
      },
      {
        q: 'How many frames are in one hour at 29.97 DF?',
        a: '107,892. Non-drop counts 108,000 frame numbers per hour; drop-frame skips 2 numbers in 54 of the 60 minutes, which removes 108.',
      },
      {
        q: 'Why does 23.976 timecode drift from the clock?',
        a: '23.976 fps has no drop-frame mode: its timecode counts 24 frames per second while the video plays at 24000/1001. One hour of timecode lasts 3,603.6 seconds of real time. The Real time field always shows the actual duration.',
      },
      {
        q: 'How is timecode converted to another frame rate?',
        a: 'By real time: the timecode becomes seconds at the source rate, then the nearest frame at the target rate. 01:00:00;00 at 29.97 DF is 3,599.996 seconds, which is 01:00:00:00 at 25 fps.',
      },
      {
        q: 'Can I enter frames or seconds instead of timecode?',
        a: 'Yes. In Convert, set From to Frames or Seconds. Seconds can have decimals and are rounded to the nearest frame.',
      },
    ],
  },
  related: ['video-info', 'subtitle-shift', 'shutter-angle-calculator'],
  willDo: [
    'Add and subtract timecodes, and get the duration between two of them',
    'Convert between timecode, frames and seconds, and from one frame rate to another',
    'Work at 23.976, 24, 25, 29.97 DF and NDF, 30, 48, 50, 59.94 DF and NDF, 60 fps or a custom rate',
  ],
});
