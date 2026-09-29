import { defineTool } from '../../define';

export default defineTool({
  id: 'burn-subtitles',
  code: 'V16',
  slug: 'burn-subtitles',
  category: 'video',
  name: 'Burn Subtitles into Video',
  tagline: 'Hardcode SRT, VTT or ASS subtitles into the picture with your font, size and color.',
  summary: 'Hardsub SRT, VTT or ASS with your style',
  status: 'soon',
  wave: 2,
  runtime: 'server-cpu',
  engines: ['video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  cost: { kind: 'perMinute', credits: 1, minCredits: 2 },
  surfaces: ['web', 'api'],
  seo: {
    title: 'Burn Subtitles into Video, SRT, VTT or ASS | EditToolbelt',
    description:
      'Hardcode SRT, VTT or ASS subtitles into your video. Set font, size, color, outline, background box and position, and ASS styles are kept. Uses credits.',
    h1: 'Burn Subtitles into Video',
    primaryQuery: 'burn subtitles into video',
    secondaryQueries: ['add subtitles to video permanently', 'hardcode srt'],
  },
  related: ['auto-subtitles', 'subtitle-converter', 'subtitle-shift'],
  willDo: [
    'Burn SRT, VTT or ASS subtitles into the picture, or take them straight from Auto Subtitles',
    'Set font, size, color, outline, background box, position and max width',
    'Keep ASS styles as written, with bundled fonts that cover Cyrillic',
  ],
});
