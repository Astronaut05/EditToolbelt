import { defineTool } from '../../define';

export default defineTool({
  id: 'bitrate-calculator',
  code: 'T06',
  slug: 'bitrate-calculator',
  category: 'subtitles-time',
  name: 'Bitrate & File Size Calculator',
  tagline: 'Enter any two of file size, bitrate and duration to get the third, in Mbps, MB and GB.',
  summary: 'Any two of size, bitrate and duration',
  status: 'live',
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
    howTo: [
      'Pick what you need: the file size, the video bitrate for a target size, or the duration that fits.',
      'Type the duration as 1:30:00, 90:00 or 90s.',
      'Enter the video bitrate in Mbps or kbps and the audio bitrate in kbps.',
      'Read the result in MB, MiB and GB. Copy it, or copy the link to share the inputs.',
    ],
    faq: [
      {
        q: 'How do I work out video file size from bitrate?',
        a: 'Add the video and audio bitrates, multiply by the duration in seconds and divide by 8. 60 seconds at 8 Mbps video and 192 kbps audio is 8,192 kbps × 60 s ÷ 8 = 61,440 kB, or 61.44 MB.',
      },
      {
        q: 'What bitrate do I need to hit 100 MB?',
        a: 'Divide the size in kilobits by the duration, then subtract the audio. For 5 minutes with 128 kbps audio: 800,000 kbit ÷ 300 s = 2,667 kbps, minus 128 leaves about 2,539 kbps for video. Aim about 5% lower, since encoders overshoot.',
      },
      {
        q: 'Why does Windows show a smaller size?',
        a: 'Windows divides by 1,048,576 bytes and still writes MB. 61.44 MB is 58.59 MiB, and that is the number Windows shows.',
      },
      {
        q: 'Does the same bitrate always give the same quality?',
        a: 'No. The same bitrate looks clean on a talking head and blocky on water or confetti, and HEVC and AV1 need less than H.264 for the same look. The typical bitrates list is a starting point, not a rule.',
      },
      {
        q: 'Does the result include the container?',
        a: 'No, it counts audio and video data only. MP4 and MOV add a little on top, usually under 1%.',
      },
    ],
  },
  related: ['compress-video', 'storage-calculator', 'video-info'],
  willDo: [
    'Enter any two of file size, bitrate and duration to get the third, with separate video and audio bitrates',
    'Find the video bitrate you need to land on a target file size',
    'Compare with typical bitrates for common codecs, labeled as a guide, not a rule',
  ],
});
