import { defineTool } from '../../define';

export default defineTool({
  id: 'social-media-image-resizer',
  code: 'P13',
  slug: 'social-media-image-resizer',
  category: 'photo',
  name: 'Social Media Image Resizer',
  tagline: 'Turn one image into the sizes you need for Instagram, YouTube, TikTok and more.',
  summary: 'One image, every platform size',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-geometry'],
  ui: 'form',
  batch: false,
  accepts: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/heic',
    'image/heif',
  ],
  outputs: ['jpg', 'png', 'webp', 'avif', 'zip'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Instagram Image Resizer, Every Size at Once | EditToolbelt',
    description:
      'Resize one image for Instagram, YouTube, TikTok, X, LinkedIn, Facebook and Pinterest at once. Keep a focal point in frame, or fit on a blurred background.',
    h1: 'Instagram Image Resizer',
    primaryQuery: 'instagram image resizer',
    secondaryQueries: ['resize image for youtube thumbnail', 'social media image sizes'],
    howTo: [
      'Drop an image, or choose one from your device.',
      'Tick the sizes you need: Instagram posts and stories, a YouTube thumbnail or banner, X, LinkedIn, Facebook, Pinterest.',
      'Click the subject so every crop keeps it in frame, or fit the whole image on a blurred copy of itself or a color.',
      'Resize it. One size downloads as the image, several as a ZIP with each size named.',
    ],
    faq: [
      {
        q: 'What size is an Instagram post?',
        a: '1080 × 1080 px for a square post and 1080 × 1350 px (4:5) for a portrait one, which fills more of the feed. 1080 × 1440 px (3:4) shows whole in the profile grid. Stories and Reel covers are 1080 × 1920 px.',
      },
      {
        q: 'What size is a YouTube thumbnail?',
        a: '1280 × 720 px, under 2 MB. If a JPG or WebP would be bigger, the quality is lowered just enough to stay under the limit, and the notes say so.',
      },
      {
        q: 'How do I stop faces getting cut off?',
        a: 'Click or tap the face in the preview to set the focal point. Every size is cropped around it, as far as the edges of the image allow, and the outlines show what each size keeps.',
      },
      {
        q: 'Can I keep the whole image without cropping?',
        a: 'Choose Fit on blur to place the whole image on a blurred copy of itself, or Fit on color to place it on a color you pick. Nothing is cut off.',
      },
      {
        q: 'How up to date are the sizes?',
        a: 'Each size was checked against the platform’s current guidance on 1 October 2026, and the list is reviewed every three months.',
      },
    ],
  },
  related: ['resize-image', 'crop-image', 'split-image'],
  willDo: [
    'Export one image to many presets at once, like Instagram 1080×1350 and YouTube 1280×720',
    'Fill and crop around a focal point, or fit with a blurred or solid color background',
    'Pick sizes for Instagram, YouTube, TikTok, X, LinkedIn, Facebook and Pinterest',
  ],
});
