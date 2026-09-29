import { defineTool } from '../../define';

export default defineTool({
  id: 'subtitle-shift',
  code: 'T02',
  slug: 'subtitle-shift',
  category: 'subtitles-time',
  name: 'Subtitle Sync & Shift',
  tagline: 'Fix subtitles that start early, run late or drift, down to the millisecond.',
  summary: 'Shift, rescale or two-point sync',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Subtitle Sync, Fix Subtitle Delay and Drift | EditToolbelt',
    description:
      'Shift every cue by a set number of ms, rescale timing between frame rates such as 23.976 and 25 fps, or fix offset and drift at once with two-point sync.',
    h1: 'Subtitle Sync',
    primaryQuery: 'subtitle sync',
    secondaryQueries: ['shift srt timing', 'fix subtitle delay'],
  },
  related: ['subtitle-converter', 'subtitle-editor', 'timecode-calculator'],
  willDo: [
    'Move all cues, or every cue from a chosen one onward, earlier or later with ms precision',
    'Rescale timing between frame rates, such as 23.976 to 25 fps for PAL speed-up, and back',
    'Fix offset and drift together by setting the right time for one early and one late cue',
  ],
});
