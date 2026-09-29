import { defineTool } from '../../define';

export default defineTool({
  id: 'gif-to-mp4',
  code: 'V05',
  slug: 'gif-to-mp4',
  category: 'video',
  name: 'GIF to MP4',
  tagline: 'Turn an animated GIF into a much smaller MP4 or WebM for social posts and the web.',
  summary: 'Much smaller files for social and web',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'GIF to MP4, Much Smaller Files for Social | EditToolbelt',
    description:
      'Convert an animated GIF to MP4 or WebM, much smaller for social posts and web pages. Frame timing is kept, and you choose loops and a background color.',
    h1: 'GIF to MP4',
    primaryQuery: 'gif to mp4',
    secondaryQueries: ['convert gif to video'],
  },
  related: ['video-to-gif', 'loop-video', 'compress-video'],
  willDo: [
    'Convert an animated GIF to MP4 or WebM, much smaller for social posts and the web',
    'Repeat the animation a set number of times in the video',
    'Fill transparent areas with a background color you choose',
  ],
});
