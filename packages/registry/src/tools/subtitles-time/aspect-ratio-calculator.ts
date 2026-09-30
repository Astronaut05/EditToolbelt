import { defineTool } from '../../define';

export default defineTool({
  id: 'aspect-ratio-calculator',
  code: 'T05',
  slug: 'aspect-ratio-calculator',
  category: 'subtitles-time',
  name: 'Aspect Ratio Calculator',
  tagline: 'Get the ratio of any resolution, or the missing side for 16:9, 9:16, 4:5 and more.',
  summary: 'Ratio, missing side and even sizes',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile', 'panel'],
  seo: {
    title: 'Aspect Ratio Calculator, 16:9 to 2.39:1 | EditToolbelt',
    description:
      'Simplify any resolution to a ratio, get the missing side for 16:9, 9:16, 4:3, 1:1, 4:5, 2.39:1 and more, and fit a frame into a box with bar sizes.',
    h1: 'Aspect Ratio Calculator',
    primaryQuery: 'aspect ratio calculator',
    secondaryQueries: ['16:9 calculator', 'resolution calculator'],
    howTo: [
      'Pick what to calculate: the ratio of a size, the missing side for a ratio, or how a frame fits into a box.',
      'Type the width and height in pixels, or a ratio such as 16:9, 2.39:1 or 1.85.',
      'Keep Even numbers on for video, since most codecs need even dimensions.',
      'Read the results on the right. Copy a value, or copy the link to share it.',
    ],
    faq: [
      {
        q: 'What is the aspect ratio of 1920×1080?',
        a: '16:9, which is 1.778:1. 1280×720, 2560×1440 and 3840×2160 are 16:9 as well.',
      },
      {
        q: 'What height do I need for 2.39:1 at 1920 wide?',
        a: '1920 ÷ 2.39 is 803.35 px. Rounded to an even number for video it is 804, so the frame is 1920×804.',
      },
      {
        q: 'Why do video sizes need even numbers?',
        a: 'Most video stores color at half the width and height (4:2:0 chroma subsampling), so H.264 and HEVC encoders need even dimensions and many refuse odd ones.',
      },
      {
        q: 'What is the difference between letterbox and pillarbox?',
        a: 'Letterbox bars sit above and below a picture that is wider than the frame, like 2.39:1 inside 16:9. Pillarbox bars sit left and right of a narrower picture, like 4:3 inside 16:9. Fit into shows the size of each bar in px.',
      },
      {
        q: 'What size is 9:16?',
        a: '9:16 is vertical 16:9, used by Reels, TikTok and Shorts. The usual size is 1080×1920.',
      },
    ],
  },
  related: ['resize-video', 'resize-image', 'social-media-image-resizer'],
  willDo: [
    'Turn any width and height into a simplified ratio and decimal, such as 1920×1080 to 16:9',
    'Enter a ratio and one side to get the other, rounded to even numbers for video codecs',
    'Fit a frame into a box and see the size of the letterbox or pillarbox bars in px',
  ],
});
