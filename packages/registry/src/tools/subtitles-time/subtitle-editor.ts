import { defineTool } from '../../define';

export default defineTool({
  id: 'subtitle-editor',
  code: 'T03',
  slug: 'subtitle-editor',
  category: 'subtitles-time',
  name: 'Subtitle Editor',
  tagline: 'Edit subtitle text and timing on a timeline while your video or audio plays.',
  summary: 'Timing, text and reading-speed checks',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'timeline',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Online Subtitle Editor, Edit SRT with Video | EditToolbelt',
    description:
      'Split, merge and retime subtitle cues on a timeline with your video playing. Check reading speed, line length, gaps and overlaps, with one-click fixes.',
    h1: 'Online Subtitle Editor',
    primaryQuery: 'online subtitle editor',
    secondaryQueries: ['srt editor'],
  },
  related: ['auto-subtitles', 'subtitle-converter', 'subtitle-shift'],
  willDo: [
    'Split, merge and drag cues on a timeline while the video or audio plays',
    'Edit cue text in place, with find and replace across the whole file',
    'Check characters per line, characters per second, minimum gaps and overlaps, with one-click fixes',
  ],
});
