import { defineTool } from '../../define';

export default defineTool({
  id: 'video-to-gif',
  code: 'V04',
  slug: 'video-to-gif',
  category: 'video',
  name: 'Video to GIF',
  tagline: 'Turn part of a video into an animated GIF or WebP, with the size shown before export.',
  summary: 'GIF or animated WebP, 5-30 fps',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['gif', 'webp'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Video to GIF, Set Range, FPS and Width | EditToolbelt',
    description:
      'Turn any part of a video into an animated GIF or WebP. Set fps (5-30), width, loop count and dithering, and see the estimated size before you export.',
    h1: 'Video to GIF',
    primaryQuery: 'video to gif',
    secondaryQueries: ['mp4 to gif', 'make gif from video'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Drag the handles to the part you want, or type In and Out. It starts with the first 5 seconds.',
      'Set the frame rate and width; the estimate shows the frames and size before you start.',
      'Select Make GIF, watch it loop, and download it.',
    ],
    faq: [
      {
        q: 'How do I keep the GIF small?',
        a: 'Size grows with width × frames. 480 px at 12 fps suits most chats; 320 px or 8-10 fps halves it. A shorter range helps most. Animated WebP is often a third of the size of the same GIF.',
      },
      {
        q: 'Why does my GIF look grainy?',
        a: 'A GIF holds at most 256 colors. Dithering mixes them into fine dots to hide banding in gradients and skin; turn it off for flat graphics and screen recordings, which then compress smaller.',
      },
      {
        q: 'What do One palette and Per frame mean?',
        a: 'One palette picks 255 colors for the whole clip: steadier colors and a smaller file. Per frame gives each frame its own 255, which suits clips whose colors change a lot, at a larger size.',
      },
      {
        q: 'Will it loop?',
        a: 'Yes, forever by default. You can make it play once, or three times.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. Frames are read and the GIF is made on your device, in your browser.',
      },
    ],
  },
  related: ['trim-video', 'gif-to-mp4', 'extract-frames'],
  willDo: [
    'Pick the range on a timeline, then set fps from 5 to 30 (default 12) and width (default 480)',
    'Choose loop count, speed, dithering, and one palette per frame or one for the whole clip',
    'Export GIF or animated WebP, with an estimated size and a warning above 15 MB',
  ],
});
