import { defineTool } from '../../define';

export default defineTool({
  id: 'bitrate-calculator',
  code: 'T06',
  slug: 'bitrate-calculator',
  category: 'subtitles-time',
  name: 'Bitrate & File Size Calculator',
  tagline: 'Enter any two of file size, bitrate and duration to get the third, in Mbps, MB and GB.',
  summary: 'Any two of size, bitrate and duration',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile', 'panel'],
  seo: {
    title: 'Video Bitrate Calculator, Mbps to File Size | EditToolbelt',
    description:
      'Get file size from bitrate and duration, or the video bitrate you need to hit a target size. Separate video and audio bitrates, with results in MB and MiB.',
    h1: 'Video Bitrate Calculator',
    primaryQuery: 'video bitrate calculator',
    secondaryQueries: ['file size calculator video', 'bitrate to file size'],
  },
  related: ['compress-video', 'storage-calculator', 'video-info'],
  willDo: [
    'Enter any two of file size, bitrate and duration to get the third, with separate video and audio bitrates',
    'Find the video bitrate you need to land on a target file size',
    'Compare with typical bitrates for common codecs, labeled as a guide, not a rule',
  ],
});
