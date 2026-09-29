import { defineTool } from '../../define';

export default defineTool({
  id: 'reverse-video',
  code: 'V18',
  slug: 'reverse-video',
  category: 'video',
  name: 'Reverse Video',
  tagline: 'Play a clip backwards, with the sound reversed too or left out.',
  summary: 'Play it backwards, with or without sound',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Reverse Video, Play a Clip Backwards | EditToolbelt',
    description:
      'Play a video backwards, with the audio reversed too or removed. It runs in your browser in chunks to keep memory in check, and warns you before long clips.',
    h1: 'Reverse Video',
    primaryQuery: 'reverse video',
    secondaryQueries: [],
  },
  related: ['loop-video', 'video-speed', 'video-to-gif'],
  willDo: [
    'Reverse the picture, with the audio reversed too or left out',
    'Work through the clip in chunks in your browser to keep memory use down',
    'Warn you before starting on a long clip',
  ],
});
