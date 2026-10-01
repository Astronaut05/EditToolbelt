import { defineTool } from '../../define';

export default defineTool({
  id: 'exif-remover',
  code: 'P15',
  slug: 'exif-remover',
  category: 'photo',
  name: 'Photo Metadata Viewer & Remover',
  tagline: 'See what a photo reveals, from camera to GPS location, and remove it before sharing.',
  summary: 'View and strip EXIF, GPS and camera data',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['media-probe', 'image-codec'],
  ui: 'analyzer',
  batch: true,
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
  outputs: ['jpg', 'png', 'webp'],
  limits: { client: { maxBytes: 200 * 1024 * 1024, maxPixels: 100_000_000 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Remove EXIF Data, Including GPS Location | EditToolbelt',
    description:
      'View camera, lens, settings, date and GPS in any photo, then remove all metadata or only the groups you pick. JPEG pixels are not re-encoded.',
    h1: 'Remove EXIF Data',
    primaryQuery: 'remove exif data',
    secondaryQueries: ['view photo metadata', 'remove location from photo'],
    howTo: [
      'Drop one photo or many. Each one’s metadata shows at once: camera, settings, date, people and location.',
      'Choose what to remove: everything, the location only, or all but the camera and its settings.',
      'Download the cleaned photo. JPG, PNG and WebP keep every pixel exactly as it was.',
    ],
    faq: [
      {
        q: 'How do I remove the location from a photo?',
        a: 'Choose Location only. The GPS coordinates and altitude come out, along with any XMP or IPTC that names a place; the camera, the date and everything else stay.',
      },
      {
        q: 'Does removing EXIF lower the quality?',
        a: 'No. For JPG, PNG and WebP only the metadata blocks are rewritten; the picture data is copied byte for byte. HEIC, AVIF and TIFF can’t be edited in place here, so they are saved as PNG, pixel for pixel.',
      },
      {
        q: 'Why are the orientation and the colour profile kept?',
        a: 'Without the orientation a phone photo would show turned on its side, and without the colour profile its colours would shift. Neither says anything about you.',
      },
      {
        q: 'What else can a photo carry?',
        a: 'Serial numbers of the camera and lens, the owner’s name, the editing software, a small preview of the original before cropping, and with motion or HDR photos extra images after the end. Everything removes all of it.',
      },
      {
        q: 'Are my photos uploaded?',
        a: 'No. They are read and cleaned in your browser and never leave your device.',
      },
    ],
  },
  related: ['compress-image', 'blur-image', 'image-converter'],
  willDo: [
    'Show camera, lens, settings, date and GPS coordinates for each photo',
    'Remove all metadata or only the groups you choose, across a batch of photos',
    'Strip JPEG metadata without re-encoding, so the pixels stay untouched',
  ],
});
