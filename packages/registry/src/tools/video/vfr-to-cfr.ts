import { defineTool } from '../../define';

export default defineTool({
  id: 'vfr-to-cfr',
  code: 'V15',
  slug: 'vfr-to-cfr',
  category: 'video',
  name: 'VFR to CFR',
  tagline:
    'Convert variable frame rate phone and screen recordings to constant, so they stay in sync.',
  summary: 'Keep phone footage in sync in Premiere',
  status: 'beta',
  wave: 2,
  runtime: 'server-cpu',
  engines: ['video-ffmpeg-server'],
  ui: 'form',
  batch: false,
  accepts: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  outputs: ['mp4'],
  limits: {
    // Runs on the worker; a copy of the site with no server path holds the run (ToolShell).
    server: {
      free: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 },
      paid: { maxBytes: 10 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
    // One visually lossless pass; 4 h of 1080p takes well under 2 h.
    timeoutSec: 2 * 60 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'panel', 'api'],
  seo: {
    title: 'Convert Variable Frame Rate to Constant, Fix Sync | EditToolbelt',
    description:
      'Turn variable frame rate phone and screen recordings into constant frame rate, so audio stays in sync in Premiere and Resolve. Already CFR? No charge.',
    h1: 'Convert Variable Frame Rate to Constant',
    primaryQuery: 'convert variable frame rate to constant',
    secondaryQueries: ['vfr to cfr', 'fix audio sync premiere phone video'],
    howTo: [
      'Drop a phone or screen recording: MP4, MOV, WebM or MKV.',
      'Leave Frame rate on Auto for the nearest standard rate, or pick one, such as 25 for a PAL timeline.',
      'Select Convert on our servers. It checks the file first and charges nothing if it is already constant.',
      'Download the MP4 and import it into Premiere Pro, Resolve or Final Cut.',
    ],
    faq: [
      {
        q: 'Why does my phone video drift out of sync in Premiere?',
        a: 'Phones record at a variable frame rate: the gap between frames changes with light and load. Editors expect a steady rate, so the picture slowly slips against the sound. A constant frame rate copy keeps them together.',
      },
      {
        q: 'Which frame rate should I pick?',
        a: 'Auto picks the standard rate nearest to the video’s average, such as 29.97 for most phones. Pick your timeline’s rate instead if you know it, such as 25 in Europe or 23.976 for film.',
      },
      {
        q: 'Will it lose quality?',
        a: 'It is re-encoded visually lossless by default, with a keyframe every second so it scrubs smoothly. 10-bit HDR footage stays 10-bit, as H.265, so its colour is unchanged.',
      },
      {
        q: 'What if my video is already constant?',
        a: 'Our servers check the frames’ timing before anything runs. If it is already constant, it says so and nothing is charged.',
      },
    ],
  },
  related: ['video-info', 'merge-videos', 'timecode-calculator'],
  willDo: [
    'Convert to the nearest standard rate (23.976 to 60 fps) automatically, or pick one yourself',
    'Encode visually lossless by default, and keep or drop the audio',
    'Check the file first, and do nothing and charge nothing if it is already constant',
  ],
});
