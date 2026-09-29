import { defineTool } from '../../define';

export default defineTool({
  id: 'subtitle-converter',
  code: 'T01',
  slug: 'subtitle-converter',
  category: 'subtitles-time',
  name: 'Subtitle Converter',
  tagline: 'Convert subtitle files between SRT, WebVTT, ASS/SSA, SBV and plain text.',
  summary: 'SRT, VTT, ASS and SBV, in batches',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'form',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Subtitle Converter, SRT, VTT, ASS and SBV | EditToolbelt',
    description:
      'Convert SRT, WebVTT, ASS/SSA, SBV and TXT subtitles, one file or a batch. See exactly what the new format drops, and get clean UTF-8 files back.',
    h1: 'Subtitle Converter',
    primaryQuery: 'subtitle converter',
    secondaryQueries: ['srt to vtt', 'vtt to srt', 'ass to srt'],
  },
  related: ['subtitle-shift', 'subtitle-editor', 'burn-subtitles'],
  willDo: [
    'Convert between SRT, WebVTT, ASS/SSA, SBV and plain text, one file or a whole batch',
    'Keep line breaks from ASS to SRT, and turn italic overrides into <i> tags if you want',
    'Report anything the new format cannot hold, such as "12 style overrides removed"',
  ],
});
