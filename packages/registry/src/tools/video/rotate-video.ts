import { defineTool } from '../../define';

export default defineTool({
  id: 'rotate-video',
  code: 'V11',
  slug: 'rotate-video',
  category: 'video',
  name: 'Rotate & Flip Video',
  tagline: 'Turn a video 90°, 180° or 270°, or flip it, so sideways phone clips play upright.',
  summary: '90°, 180° or 270°, plus flips',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Rotate Video, Fix Sideways Phone Clips | EditToolbelt',
    description:
      'Rotate a video 90°, 180° or 270°, or flip it. Fast mode sets the rotation flag instantly. Burn in re-encodes for players that ignore the flag.',
    h1: 'Rotate Video',
    primaryQuery: 'rotate video',
    secondaryQueries: ['flip video'],
  },
  related: ['resize-video', 'trim-video', 'video-info'],
  willDo: [
    'Rotate 90°, 180° or 270°, and flip the picture',
    'Fast mode sets the rotation flag instantly, and most players follow it',
    'Burn in re-encodes for players that ignore the flag, and is the default for 90°',
  ],
});
