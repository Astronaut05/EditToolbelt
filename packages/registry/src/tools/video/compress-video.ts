import { defineTool } from '../../define';

export default defineTool({
  id: 'compress-video',
  code: 'V02',
  slug: 'compress-video',
  category: 'video',
  name: 'Compress Video',
  tagline: 'Shrink a video to a set size like 8 MB or 25 MB, or to a quality level you pick.',
  summary: 'By target size, quality or preset',
  status: 'soon',
  wave: 1,
  runtime: 'hybrid',
  engines: ['video-webcodecs', 'video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 1, minCredits: 2 },
  surfaces: ['web', 'mobile', 'api'],
  seo: {
    title: 'Compress Video, Fit Discord and Email Limits | EditToolbelt',
    description:
      'Shrink a video to 8, 10, 25, 50 or 100 MB, or by quality, or set resolution, fps and bitrate yourself. See the estimated size before you start.',
    h1: 'Compress Video',
    primaryQuery: 'compress video',
    secondaryQueries: ['compress video for discord', 'reduce video size', 'compress mp4'],
  },
  related: ['trim-video', 'video-converter', 'bitrate-calculator'],
  willDo: [
    'Hit a target size of 8, 10, 25, 50 or 100 MB, labelled for Discord, email and WhatsApp',
    'Pick High, Medium or Small quality, or set resolution, fps, bitrate and codec yourself',
    'Show the estimated output before you start, and suggest a lower resolution when needed',
  ],
});
