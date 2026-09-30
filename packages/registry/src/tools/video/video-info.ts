import { defineTool } from '../../define';

export default defineTool({
  id: 'video-info',
  code: 'V08',
  slug: 'video-info',
  category: 'video',
  name: 'Video Info & VFR Check',
  tagline:
    'See codecs, frame rate, color and audio details, and whether the frame rate is variable.',
  summary: 'Codecs, fps, HDR and VFR at a glance',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['media-probe'],
  ui: 'analyzer',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Video Metadata Viewer, Check FPS, VFR and HDR | EditToolbelt',
    description:
      "See a video's container, codecs, resolution, frame rate, bitrate, color space and audio. Flags variable frame rate and HDR, and exports text or JSON.",
    h1: 'Video Metadata Viewer',
    primaryQuery: 'video metadata viewer',
    secondaryQueries: [
      'check video frame rate',
      'is my video variable frame rate',
      'mediainfo online',
    ],
  },
  related: ['vfr-to-cfr', 'video-converter', 'bitrate-calculator'],
  willDo: [
    'Show container, codecs, resolution, fps, bitrate, color space, audio, rotation and encoder',
    'Flag variable frame rate that may drift in Premiere, and HDR that looks washed out in SDR timelines',
    'Read only the headers where possible, so even huge files are instant, and export as text or JSON',
  ],
});
