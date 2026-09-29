import { defineTool } from '../../define';

export default defineTool({
  id: 'social-media-image-resizer',
  code: 'P13',
  slug: 'social-media-image-resizer',
  category: 'photo',
  name: 'Social Media Image Resizer',
  tagline: 'Turn one image into the sizes you need for Instagram, YouTube, TikTok and more.',
  summary: 'One image, every platform size',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Instagram Image Resizer, Every Size at Once | EditToolbelt',
    description:
      'Resize one image for Instagram, YouTube, TikTok, X, LinkedIn, Facebook and Pinterest at once. Keep a focal point in frame, or fit on a blurred background.',
    h1: 'Instagram Image Resizer',
    primaryQuery: 'instagram image resizer',
    secondaryQueries: ['resize image for youtube thumbnail', 'social media image sizes'],
  },
  related: ['resize-image', 'crop-image', 'split-image'],
  willDo: [
    'Export one image to many presets at once, like Instagram 1080×1350 and YouTube 1280×720',
    'Fill and crop around a focal point, or fit with a blurred or solid color background',
    'Pick sizes for Instagram, YouTube, TikTok, X, LinkedIn, Facebook and Pinterest',
  ],
});
