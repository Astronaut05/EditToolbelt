import { defineTool } from '../../define';

export default defineTool({
  id: 'exif-remover',
  code: 'P15',
  slug: 'exif-remover',
  category: 'photo',
  name: 'Photo Metadata Viewer & Remover',
  tagline: 'See what a photo reveals, from camera to GPS location, and remove it before sharing.',
  summary: 'View and strip EXIF, GPS and camera data',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['media-probe', 'image-codec'],
  ui: 'analyzer',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Remove EXIF Data, Including GPS Location | EditToolbelt',
    description:
      'View camera, lens, settings, date and GPS in any photo, then remove all metadata or only the groups you pick. JPEG pixels are not re-encoded.',
    h1: 'Remove EXIF Data',
    primaryQuery: 'remove exif data',
    secondaryQueries: ['view photo metadata', 'remove location from photo'],
  },
  related: ['compress-image', 'blur-image', 'image-converter'],
  willDo: [
    'Show camera, lens, settings, date and GPS coordinates for each photo',
    'Remove all metadata or only the groups you choose, across a batch of photos',
    'Strip JPEG metadata without re-encoding, so the pixels stay untouched',
  ],
});
