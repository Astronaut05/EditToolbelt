import { defineTool } from '../../define';

export default defineTool({
  id: 'aspect-ratio-calculator',
  code: 'T05',
  slug: 'aspect-ratio-calculator',
  category: 'subtitles-time',
  name: 'Aspect Ratio Calculator',
  tagline: 'Get the ratio of any resolution, or the missing side for 16:9, 9:16, 4:5 and more.',
  summary: 'Ratio, missing side and even sizes',
  status: 'soon',
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
  },
  related: ['resize-video', 'resize-image', 'social-media-image-resizer'],
  willDo: [
    'Turn any width and height into a simplified ratio and decimal, such as 1920×1080 to 16:9',
    'Enter a ratio and one side to get the other, rounded to even numbers for video codecs',
    'Fit a frame into a box and see the size of the letterbox or pillarbox bars in px',
  ],
});
