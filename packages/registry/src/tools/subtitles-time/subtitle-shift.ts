import { defineTool } from '../../define';

export default defineTool({
  id: 'subtitle-shift',
  code: 'T02',
  slug: 'subtitle-shift',
  category: 'subtitles-time',
  name: 'Subtitle Sync & Shift',
  tagline: 'Fix subtitles that start early, run late or drift, down to the millisecond.',
  summary: 'Shift, rescale or two-point sync',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'form',
  batch: false,
  accepts: ['.srt', '.vtt', '.webvtt', '.ass', '.ssa', '.sbv'],
  outputs: ['srt', 'vtt', 'ass', 'ssa', 'sbv'],
  limits: { client: { maxBytes: 20 * 1024 * 1024 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Subtitle Sync, Fix Subtitle Delay and Drift | EditToolbelt',
    description:
      'Shift every cue by a set number of ms, rescale timing between frame rates such as 23.976 and 25 fps, or fix offset and drift at once with two-point sync.',
    h1: 'Subtitle Sync',
    primaryQuery: 'subtitle sync',
    secondaryQueries: ['shift srt timing', 'fix subtitle delay'],
    howTo: [
      'Drop an SRT, VTT, ASS, SSA or SBV file.',
      'Pick Shift to move cues earlier or later, Frame rate when they drift steadily, or Two points to fix both at once.',
      'For Shift, type the seconds (−2.5 is earlier); for Two points, pick an early and a late cue and type when each should start.',
      'Select Sync, check the preview and download. The file keeps its format and styling.',
    ],
    faq: [
      {
        q: 'The subtitles are fine at the start but get later and later. What do I pick?',
        a: 'That’s drift, usually a frame-rate mismatch. Try Frame rate with 23.976 → 25 (or back), or use Two points: set the right time for one cue near the start and one near the end, and every cue in between follows.',
      },
      {
        q: 'How do I find the right time for a cue?',
        a: 'Play the video in any player, pause on the line being spoken, and read the time off the player. Type it as 00:12:03.500, 12:03.5 or 723.5 seconds.',
      },
      {
        q: 'Will it change my styles or positions?',
        a: 'No. Only the start and end times are rewritten. ASS styles, WebVTT positions, cue numbers and comments stay exactly as they were, and the file keeps its format.',
      },
      {
        q: 'Can I move only the second half of the file?',
        a: 'Yes. In Shift, set From cue to the first cue that’s off, and only that cue and those after it move.',
      },
      {
        q: 'What if a cue would start before 0:00?',
        a: 'It starts at 0:00 instead, keeps its end time, and the result says how many were moved like that.',
      },
    ],
  },
  related: ['subtitle-converter', 'subtitle-editor', 'timecode-calculator'],
  willDo: [
    'Move all cues, or every cue from a chosen one onward, earlier or later with ms precision',
    'Rescale timing between frame rates, such as 23.976 to 25 fps for PAL speed-up, and back',
    'Fix offset and drift together by setting the right time for one early and one late cue',
  ],
});
