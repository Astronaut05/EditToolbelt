import { defineTool } from '../../define';

export default defineTool({
  id: 'trim-video',
  code: 'V01',
  slug: 'trim-video',
  category: 'video',
  name: 'Trim Video',
  tagline: 'Cut the start and end, or keep several ranges and join them into one clip.',
  summary: 'Keyframe-fast or frame-exact',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Trim Video, Fast Cuts with No Quality Loss | EditToolbelt',
    description:
      'Cut the start and end of a video, or keep several ranges and join them. Fast mode copies the streams with no quality loss. Precise mode is frame-exact.',
    h1: 'Trim Video',
    primaryQuery: 'trim video',
    secondaryQueries: ['cut video online', 'cut mp4', 'video cutter no watermark'],
  },
  related: ['merge-videos', 'compress-video', 'video-to-gif'],
  willDo: [
    'Set in and out points on a timeline, and add ranges to keep or remove',
    'Fast mode snaps to the nearest keyframes and copies the streams, with no re-encode',
    'Precise mode re-encodes for cuts on the exact frame you choose',
  ],
});
