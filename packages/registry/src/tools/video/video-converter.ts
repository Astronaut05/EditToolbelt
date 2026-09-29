import { defineTool } from '../../define';

export default defineTool({
  id: 'video-converter',
  code: 'V03',
  slug: 'video-converter',
  category: 'video',
  name: 'Video Converter',
  tagline: 'Change MOV, MKV, WebM or AVI into MP4, WebM, MOV or MKV, remuxing when it can.',
  summary: 'Remux when it can, re-encode when it must',
  status: 'soon',
  wave: 1,
  runtime: 'hybrid',
  engines: ['video-webcodecs', 'video-ffmpeg-wasm', 'video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'mobile', 'api'],
  crossOriginIsolated: true,
  seo: {
    title: 'Video Converter, MOV, MKV and WebM to MP4 | EditToolbelt',
    description:
      'Convert MOV, MKV, WebM and AVI to MP4, WebM, MOV or MKV. When the codecs already fit the new container, it remuxes instantly with no quality loss.',
    h1: 'Video Converter',
    primaryQuery: 'video converter',
    secondaryQueries: ['mov to mp4', 'mkv to mp4', 'webm to mp4'],
  },
  related: ['compress-video', 'video-info', 'extract-audio'],
  willDo: [
    'Convert MOV, MKV, WebM and AVI to MP4, WebM, MOV or MKV',
    "Remux instantly when the codecs already fit the new container, and re-encode only when they don't",
    'Choose the codec where it matters, or keep quality and remux whenever possible',
  ],
});
