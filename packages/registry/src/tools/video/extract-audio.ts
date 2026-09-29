import { defineTool } from '../../define';

export default defineTool({
  id: 'extract-audio',
  code: 'V06',
  slug: 'extract-audio',
  category: 'video',
  name: 'Extract Audio',
  tagline: 'Pull the soundtrack out of a video as MP3, WAV, M4A, AAC, FLAC or OGG.',
  summary: 'MP3, WAV, M4A, AAC, FLAC or OGG',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['video-webcodecs', 'audio-dsp'],
  ui: 'form',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'Extract Audio from Video, Save as MP3 or WAV | EditToolbelt',
    description:
      'Save the audio track of an MP4, MOV or WebM as MP3, WAV, M4A, AAC, FLAC or OGG. AAC audio goes into M4A as a straight copy, with no quality loss.',
    h1: 'Extract Audio from Video',
    primaryQuery: 'extract audio from video',
    secondaryQueries: ['mp4 to mp3', 'mov to mp3', 'video to audio'],
  },
  related: ['audio-converter', 'mute-video', 'transcribe-audio'],
  willDo: [
    'Save the audio as MP3, WAV, M4A, AAC, FLAC or OGG, with a bitrate for MP3 and AAC',
    'Keep the sample rate or set 44.1 or 48 kHz, and pick a track when there are several',
    'Copy AAC audio into M4A without re-encoding',
  ],
});
