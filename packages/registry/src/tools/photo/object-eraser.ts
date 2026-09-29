import { defineTool } from '../../define';

export default defineTool({
  id: 'object-eraser',
  code: 'P17',
  slug: 'object-eraser',
  category: 'photo',
  name: 'Object Eraser',
  tagline: 'Brush over an unwanted object and AI fills the area to match the rest of the photo.',
  summary: 'Brush it out, AI fills the gap',
  status: 'soon',
  wave: 3,
  runtime: 'server-gpu',
  engines: ['image-ml-server'],
  ui: 'canvas-editor',
  batch: false,
  cost: { kind: 'flat', credits: 3 },
  surfaces: ['web', 'mobile', 'api'],
  seo: {
    title: 'Remove Object from Photo, Brush and AI Fill | EditToolbelt',
    description:
      'Paint over an object and an AI inpainting model fills the area. Preview at reduced size for free, then use credits for the full-resolution result.',
    h1: 'Remove Object from Photo',
    primaryQuery: 'remove object from photo',
    secondaryQueries: [],
  },
  related: ['remove-background', 'blur-image', 'upscale-image'],
  willDo: [
    'Brush over an object, set the brush size, and erase it',
    'Fill the area with AI while the rest of the photo and its size stay the same',
    'Preview at reduced size for free, then use credits for full resolution',
  ],
});
