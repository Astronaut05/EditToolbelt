import { defineTool } from '../../define';

export default defineTool({
  id: 'subtitle-editor',
  code: 'T03',
  slug: 'subtitle-editor',
  category: 'subtitles-time',
  name: 'Subtitle Editor',
  tagline: 'Edit subtitle text and timing on a timeline while your video or audio plays.',
  summary: 'Timing, text and reading-speed checks',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'timeline',
  batch: false,
  desktopBest: true,
  accepts: ['.srt', '.vtt', '.webvtt', '.ass', '.ssa', '.sbv'],
  outputs: ['srt', 'vtt', 'ass', 'sbv'],
  limits: { client: { maxBytes: 20 * 1024 * 1024 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Online Subtitle Editor, Edit SRT with Video | EditToolbelt',
    description:
      'Split, merge and retime subtitle cues on a timeline with your video playing. Check reading speed, line length, gaps and overlaps, with one-click fixes.',
    h1: 'Online Subtitle Editor',
    primaryQuery: 'online subtitle editor',
    secondaryQueries: ['srt editor'],
    howTo: [
      'Drop an SRT, VTT, ASS or SBV file. To play along, pick the video or audio in the settings.',
      'Type in the cue list. Drag a cue on the timeline to move it, or its edges to retime it.',
      'Split at the playhead, merge, add or delete cues, and find and replace across the file.',
      'Fix what the checks find (long lines, fast reading, short gaps, overlaps), then save as SRT, VTT, ASS or SBV.',
    ],
    faq: [
      {
        q: 'Are my files uploaded?',
        a: 'No. The subtitles and the video or audio stay on your device; everything happens in this browser.',
      },
      {
        q: 'What do the checks look for?',
        a: 'Lines longer than 42 characters, more than 2 lines, reading speeds over 17 characters a second, cues under 5/6 of a second or over 7 seconds, less than 83 ms between cues, and overlaps. Change the limits in the settings to match your style guide.',
      },
      {
        q: 'What does Fix all change?',
        a: 'As little as it can: long lines are rewrapped, fast or short cues are lengthened into the free time around them, and overlaps and small gaps are closed by ending the first cue earlier. A cue with no room around it stays as it is, still marked, and every fix can be undone.',
      },
      {
        q: 'Can I keep italics?',
        a: 'Yes. <i>, <b> and <u> are kept in SRT, VTT and ASS; SBV has no styling, so they are left out there.',
      },
    ],
  },
  related: ['auto-subtitles', 'subtitle-converter', 'subtitle-shift'],
  willDo: [
    'Split, merge and drag cues on a timeline while the video or audio plays',
    'Edit cue text in place, with find and replace across the whole file',
    'Check characters per line, characters per second, minimum gaps and overlaps, with one-click fixes',
  ],
});
