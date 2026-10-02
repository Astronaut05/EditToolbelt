import { defineTool } from '../../define';

export default defineTool({
  id: 'audio-to-video',
  code: 'A16',
  slug: 'audio-to-video',
  category: 'audio',
  name: 'Audio to Video',
  tagline: 'Turn audio into a video with a moving waveform over an image, in 9:16, 1:1 or 16:9.',
  summary: 'Audiogram in 9:16, 1:1 or 16:9',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['audio-dsp', 'video-webcodecs'],
  ui: 'timeline',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['mp4', 'webm'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Audiogram Maker, Waveform Video from Audio | EditToolbelt',
    description:
      'Make an audiogram: a waveform or spectrum animation over your image or a color, with a title and captions. Render 9:16, 1:1 or 16:9 video in your browser.',
    h1: 'Audiogram Maker',
    primaryQuery: 'audiogram maker',
    secondaryQueries: ['mp3 to mp4 with image'],
    howTo: [
      'Drop an MP3, WAV, M4A or other audio file, and select the part you want on the timeline (up to 10 minutes).',
      'Pick the size: 9:16 for Reels, Shorts and TikTok, 1:1 for feeds, 16:9 for YouTube.',
      'Choose bars or a wave, its colour, and a background colour or picture. Add a title, and captions as an SRT or VTT file.',
      'Press Make video and download the MP4.',
    ],
    faq: [
      {
        q: 'Is my audio uploaded?',
        a: 'No. The video is drawn and encoded in this browser, and the audio never leaves your device.',
      },
      {
        q: 'How do I add captions?',
        a: 'Choose an SRT, VTT, ASS or SBV file timed to the whole recording, such as one from Transcribe Audio. Each caption shows while it is spoken, even when you select only part of the audio.',
      },
      {
        q: 'Why did I get a WebM instead of an MP4?',
        a: 'Some browsers can’t write H.264 video with AAC sound. Then the video is VP9 with Opus sound in WebM, which YouTube and most editors take too. Chrome, Edge and Safari write MP4.',
      },
    ],
  },
  related: ['transcribe-audio', 'trim-audio', 'resize-video'],
  willDo: [
    'Animate a waveform or spectrum over a background image or a color',
    'Add a title, and captions from Transcribe Audio',
    'Render 9:16, 1:1 or 16:9 video in your browser',
  ],
});
