import { defineTool } from '../../define';

export default defineTool({
  id: 'extract-audio',
  code: 'V06',
  slug: 'extract-audio',
  category: 'video',
  name: 'Extract Audio',
  tagline: 'Pull the soundtrack out of a video as MP3, WAV, M4A, AAC, FLAC or OGG.',
  summary: 'MP3, WAV, M4A, AAC, FLAC or OGG',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs', 'audio-dsp'],
  ui: 'form',
  batch: false,
  accepts: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'audio/mp4',
    'audio/mpeg',
    'audio/webm',
    'audio/ogg',
  ],
  outputs: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
  limits: { client: { maxBytes: 2 * 1024 ** 3, maxDurationSec: 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Extract Audio from Video, Save as MP3 or WAV | EditToolbelt',
    description:
      'Save the audio track of an MP4, MOV or WebM as MP3, WAV, M4A, AAC, FLAC or OGG. AAC audio goes into M4A as a straight copy, with no quality loss.',
    h1: 'Extract Audio from Video',
    primaryQuery: 'extract audio from video',
    secondaryQueries: ['mp4 to mp3', 'mov to mp3', 'video to audio'],
    howTo: [
      'Drop a video: MP4, MOV, WebM or MKV, up to 2 GB.',
      'Pick the format. M4A and AAC copy the sound from most phone and camera videos without re-encoding.',
      'For MP3, M4A, AAC and OGG pick a bitrate; keep the sample rate or set 44.1 or 48 kHz.',
      'Select Extract audio, listen to the result, and download it.',
    ],
    faq: [
      {
        q: 'Which format keeps the best quality?',
        a: 'Most MP4 and MOV videos carry AAC audio, and M4A or AAC copies it exactly as it is. WAV and FLAC are lossless too, but larger. MP3 re-encodes, and at 192 kbps or more it sounds the same to most ears.',
      },
      {
        q: 'How do I turn an MP4 into an MP3?',
        a: 'Drop the MP4, keep MP3 selected, and select Extract audio. The MP3 is made on your device, at 192 kbps unless you pick another bitrate.',
      },
      {
        q: 'What if the video has several audio tracks?',
        a: 'An Audio track choice appears, listing each track with its codec and channels. Pick one to extract.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. The audio is read and saved in your browser; the file never leaves your device.',
      },
    ],
  },
  related: ['audio-converter', 'mute-video', 'transcribe-audio'],
  willDo: [
    'Save the audio as MP3, WAV, M4A, AAC, FLAC or OGG, with a bitrate for MP3 and AAC',
    'Keep the sample rate or set 44.1 or 48 kHz, and pick a track when there are several',
    'Copy AAC audio into M4A without re-encoding',
  ],
});
