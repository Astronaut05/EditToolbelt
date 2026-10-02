import { defineTool } from '../../define';

export default defineTool({
  id: 'add-text-to-image',
  code: 'P10',
  slug: 'add-text-to-image',
  category: 'photo',
  name: 'Add Text to Image',
  tagline: 'Put captions and titles on a photo with stroke, shadow and a background box.',
  summary: 'Fonts with Cyrillic and Uzbek support',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['image-paint'],
  ui: 'canvas-editor',
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
  outputs: ['jpg', 'png', 'webp', 'avif'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Add Text to Image, Fonts, Stroke and Shadow | EditToolbelt',
    description:
      'Put text on a photo with font, size, color, stroke, shadow, background box, alignment and rotation. Load your own font file: it stays on your device.',
    h1: 'Add Text to Image',
    primaryQuery: 'add text to image',
    secondaryQueries: ['put text on photo', 'caption image online'],
    howTo: [
      'Drop a photo or a frame.',
      'Click where the text should go, or press Add text; type it in the panel, one line per line.',
      'Pick the font, size, weight, colour and alignment, and add an outline, a shadow or a box behind it; rotate it if you like.',
      'Drag it into place (it snaps to the middle of the image), then save the image at its full size.',
    ],
    faq: [
      {
        q: 'Which fonts can I use?',
        a: 'Onest, Montserrat, Oswald, Noto Serif and IBM Plex Mono, each with Latin, Cyrillic and Uzbek letters (oʻ gʻ, қ ғ ҳ ў), in regular and bold. Or load a TTF, OTF or WOFF2 font of your own: it is used in this browser and never uploaded.',
      },
      {
        q: 'Will the text be where I put it?',
        a: 'Yes. The text is laid out by the same code with the same fonts for the preview and for the full-size image, so a centred caption on a 6000 px photo lands exactly where it showed.',
      },
      {
        q: 'Is my photo uploaded?',
        a: 'No. The text is drawn and the image saved in this browser; nothing leaves your device.',
      },
    ],
  },
  related: ['draw-on-image', 'watermark-image', 'social-media-image-resizer'],
  willDo: [
    'Style text with font, size, color, stroke, shadow, background box, alignment and rotation',
    'Use bundled fonts with Cyrillic and Uzbek Latin, or load a font file that stays on your device',
    'Stack several text layers and line them up with snapping guides',
  ],
});
