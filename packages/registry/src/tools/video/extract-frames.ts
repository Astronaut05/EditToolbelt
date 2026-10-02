import { defineTool } from '../../define';

export default defineTool({
  id: 'extract-frames',
  code: 'V10',
  slug: 'extract-frames',
  category: 'video',
  name: 'Extract Frames / Thumbnail',
  tagline: 'Save a single frame as a thumbnail, a frame every few seconds, or a contact sheet.',
  summary: 'One frame, every N seconds, or a contact sheet',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'timeline',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['png', 'jpg', 'webp', 'zip'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Extract Frames from Video, PNG, JPG or WebP | EditToolbelt',
    description:
      'Grab one frame for a thumbnail, one every N seconds, N evenly spaced frames, or a contact sheet. Scrub frame by frame and save as PNG, JPG or WebP.',
    h1: 'Extract Frames from Video',
    primaryQuery: 'extract frames from video',
    secondaryQueries: ['video to jpg', 'get thumbnail from video'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'For one frame, move the In point to the shot: drag it, step frame by frame, or type the time.',
      'Or take a frame every few seconds, a number of frames spread evenly, or a contact sheet, from the selection between In and Out.',
      'Pick PNG, JPG or WebP and a width, then extract. Several frames download as a ZIP, named by their time.',
    ],
    faq: [
      {
        q: 'Is it the exact frame?',
        a: 'Yes. The frame on screen at the In point is decoded from the video itself, never a neighbour, and its file name says when that frame starts.',
      },
      {
        q: 'Which format should I pick?',
        a: 'PNG keeps every pixel, for thumbnails you will edit. JPG and WebP are much smaller, for sharing or a quick look.',
      },
      {
        q: 'What is a contact sheet?',
        a: 'One image with frames from across the video in a grid, 3 × 3 up to 4 × 6, each with its time. Good for an overview or for picking a shot.',
      },
    ],
  },
  related: ['video-to-gif', 'resize-image', 'add-text-to-image'],
  willDo: [
    'Grab one frame as a thumbnail, one every N seconds, or N evenly spaced frames',
    'Scrub frame by frame on a timeline to land on the exact shot',
    'Save as PNG, JPG or WebP at the size you set, or as one contact sheet',
  ],
});
