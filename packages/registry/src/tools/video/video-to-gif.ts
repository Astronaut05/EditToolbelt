import { defineTool } from '../../define';

export default defineTool({
  id: 'video-to-gif',
  code: 'V04',
  slug: 'video-to-gif',
  category: 'video',
  name: 'Video to GIF',
  tagline: 'Turn part of a video into an animated GIF or WebP, with the size shown before export.',
  summary: 'GIF or animated WebP, 5-30 fps',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Video to GIF, Set Range, FPS and Width | EditToolbelt',
    description:
      'Turn any part of a video into an animated GIF or WebP. Set fps (5-30), width, loop count and dithering, and see the estimated size before you export.',
    h1: 'Video to GIF',
    primaryQuery: 'video to gif',
    secondaryQueries: ['mp4 to gif', 'make gif from video'],
  },
  related: ['trim-video', 'gif-to-mp4', 'extract-frames'],
  willDo: [
    'Pick the range on a timeline, then set fps from 5 to 30 (default 12) and width (default 480)',
    'Choose loop count, speed, dithering, and one palette per frame or one for the whole clip',
    'Export GIF or animated WebP, with an estimated size and a warning above 15 MB',
  ],
});
