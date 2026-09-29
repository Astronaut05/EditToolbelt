import { defineTool } from '../../define';

export default defineTool({
  id: 'extract-frames',
  code: 'V10',
  slug: 'extract-frames',
  category: 'video',
  name: 'Extract Frames / Thumbnail',
  tagline: 'Save a single frame as a thumbnail, a frame every few seconds, or a contact sheet.',
  summary: 'One frame, every N seconds, or a contact sheet',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Extract Frames from Video, PNG, JPG or WebP | EditToolbelt',
    description:
      'Grab one frame for a thumbnail, one every N seconds, N evenly spaced frames, or a contact sheet. Scrub frame by frame and save as PNG, JPG or WebP.',
    h1: 'Extract Frames from Video',
    primaryQuery: 'extract frames from video',
    secondaryQueries: ['video to jpg', 'get thumbnail from video'],
  },
  related: ['video-to-gif', 'resize-image', 'add-text-to-image'],
  willDo: [
    'Grab one frame as a thumbnail, one every N seconds, or N evenly spaced frames',
    'Scrub frame by frame on a timeline to land on the exact shot',
    'Save as PNG, JPG or WebP at the size you set, or as one contact sheet',
  ],
});
