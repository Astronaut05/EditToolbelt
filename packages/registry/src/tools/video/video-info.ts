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
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs'],
  ui: 'analyzer',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['txt', 'json'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
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
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV.',
      'Read the verdict first: variable frame rate, HDR or rotation, and what to do about each.',
      'Check the details: codecs and profile, resolution and aspect, frame rate, bitrate, color and audio.',
      'Download the report as text or JSON, for a bug report or a spreadsheet.',
    ],
    faq: [
      {
        q: 'How do I know if my video has a variable frame rate?',
        a: 'Drop it here: the frame rate line says constant or variable, measured from the time of every frame, not from a header. Phones and screen recorders often record variable frame rate, which can drift out of sync in Premiere Pro.',
      },
      {
        q: 'Why does my iPhone video look washed out in my editor?',
        a: 'It is probably HDR (HLG or Dolby Vision on an HLG base). The verdict says so. Edit it on an HDR timeline, or convert it to SDR first.',
      },
      {
        q: 'Is the whole file read?',
        a: 'Only the headers and the table of frames, never the picture itself, so even a 2 GB file takes a moment. Nothing is uploaded.',
      },
      {
        q: 'Is this the same as MediaInfo?',
        a: 'It covers what editors check most: container, codecs with profile and level, resolution, pixel and display aspect, frame rate mode, bitrate, color, HDR, rotation and audio. MediaInfo lists more encoder settings.',
      },
    ],
  },
  related: ['vfr-to-cfr', 'video-converter', 'bitrate-calculator'],
  willDo: [
    'Show container, codecs, resolution, fps, bitrate, color space, audio, rotation and encoder',
    'Flag variable frame rate that may drift in Premiere, and HDR that looks washed out in SDR timelines',
    'Read only the headers where possible, so even huge files are instant, and export as text or JSON',
  ],
});
