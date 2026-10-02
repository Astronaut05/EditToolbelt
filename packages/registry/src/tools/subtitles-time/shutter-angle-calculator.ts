import { defineTool } from '../../define';

export default defineTool({
  id: 'shutter-angle-calculator',
  code: 'T07',
  slug: 'shutter-angle-calculator',
  category: 'subtitles-time',
  name: 'Shutter Angle Calculator',
  tagline: 'Convert shutter angle to shutter speed at your frame rate: 180° at 24 fps is 1/48 s.',
  summary: 'Angle to speed, and flicker-safe speeds',
  status: 'beta',
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
    howTo: [
      'Pick the conversion: angle to shutter speed, or shutter speed to angle.',
      'Enter the frame rate, or tap a common one; 23.976, 29.97 and 59.94 are the exact NTSC rates.',
      'Enter the angle in degrees, or the speed as 1/50, 50 or 0.02.',
      'Pick 50 Hz or 60 Hz mains and read the flicker-safe speeds for that light.',
    ],
    faq: [
      {
        q: 'What is the 180° shutter rule?',
        a: 'Expose each frame for half the time between frames: a shutter speed of 1 over twice the frame rate. At 24 fps that is 1/48 s, at 25 fps 1/50 s and at 30 fps 1/60 s. It gives the motion blur audiences know from film.',
      },
      {
        q: 'My camera has no 1/48. What do I use at 24 fps?',
        a: 'Use 1/50, which is 172.8°. The difference in blur is too small to see, and 1/50 is also flicker-safe under 50 Hz lighting.',
      },
      {
        q: 'Why do lights flicker on video, and how does this help?',
        a: 'Lights on mains power pulse at twice its frequency: 100 times a second on 50 Hz, 120 on 60 Hz. A shutter that stays open for a whole number of pulses (1/100, 1/50, 1/120, 1/60…) catches the same amount of light every frame, so it does not flicker.',
      },
    ],
  },
  related: ['timecode-calculator', 'storage-calculator', 'video-info'],
  willDo: [
    'Convert shutter angle to shutter speed and back at any frame rate',
    'Show the shutter speed that follows the 180° rule for your frame rate',
    'List flicker-safe shutter speeds for 50 Hz and 60 Hz mains lighting',
  ],
});
