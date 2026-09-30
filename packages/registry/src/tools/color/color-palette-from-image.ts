import { defineTool } from '../../define';

export default defineTool({
  id: 'color-palette-from-image',
  code: 'C01',
  slug: 'color-palette-from-image',
  category: 'color',
  name: 'Color Palette from Image',
  tagline: 'Extract the 3-12 dominant colors of an image and export them as CSS, JSON or ASE.',
  summary: 'Dominant 3-12 colors, with % coverage',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['image-color'],
  ui: 'form',
  batch: false,
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'],
  outputs: ['css', 'json', 'ase', 'png'],
  limits: { client: { maxBytes: 100 * 1024 ** 2 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Color Palette from Image, CSS and ASE Export | EditToolbelt',
    description:
      'Drop an image to get its 3-12 dominant colors with % coverage. Copy HEX, RGB or HSL, or export CSS variables, JSON, ASE or a PNG swatch strip.',
    h1: 'Color Palette from Image',
    primaryQuery: 'color palette from image',
    secondaryQueries: ['extract colors from image', 'image color palette generator'],
    howTo: [
      'Drop an image: a photo, a screenshot, a logo or a frame from a video.',
      'The palette appears at once. Pick how many colors, and Dominant, Vibrant or Muted.',
      'Copy any color as HEX, RGB or HSL, or download the palette as CSS, JSON, ASE or a PNG card.',
    ],
    faq: [
      {
        q: 'How are the colors chosen?',
        a: 'The image is scaled down and its pixels are grouped by color with k-means in Oklab, a color space where equal distances look equally different. Each color is the average of its group, and the % is how much of the image it covers.',
      },
      {
        q: 'What do Vibrant and Muted do?',
        a: 'Vibrant looks only at colorful pixels, for accents and brand colors. Muted looks at the quiet ones, for backgrounds and text. Dominant looks at everything.',
      },
      {
        q: 'Why are white and black left out?',
        a: 'A plain background or deep shadows would crowd the palette with near-white and near-black. Pick Include to keep them.',
      },
      {
        q: 'How do I use the ASE file?',
        a: 'In Photoshop or Illustrator, open the Swatches panel menu and choose Import Swatches (or Open Swatch Library > Other Library), then pick the .ase file.',
      },
      {
        q: 'Is my image uploaded?',
        a: 'No. The colors are found in your browser.',
      },
    ],
  },
  related: ['color-picker-from-image', 'color-converter', 'gradient-generator'],
  willDo: [
    'Extract 3 to 12 dominant, vibrant or muted colors, with the % of the image each one covers',
    'Skip near-white and near-black pixels so a plain background does not crowd the palette',
    'Export CSS variables, JSON, an ASE swatch file for Adobe apps, or a PNG swatch strip',
  ],
});
