import { defineTool } from '../../define';

export default defineTool({
  id: 'remove-noise',
  code: 'A10',
  slug: 'remove-noise',
  category: 'audio',
  name: 'Noise Reduction',
  tagline:
    'Reduce background noise, hum and hiss in voice recordings, and hear the difference first.',
  summary: 'Less noise, hum and hiss in speech',
  status: 'beta',
  wave: 2,
  runtime: 'server-cpu',
  // ffmpeg on our servers (its FFT denoiser) until a speech model with a clear
  // licence replaces it (docs/13 → Models); the browser reads the file, cuts
  // the preview and puts a video's cleaned sound back.
  engines: ['video-ffmpeg-server', 'audio-dsp', 'video-webcodecs'],
  ui: 'form',
  batch: false,
  // What our servers take. A video, or audio they don't read, has its sound
  // decoded in the browser and sent as FLAC; the picture never leaves the device.
  accepts: [
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/flac',
    'audio/ogg',
    'audio/mp4',
    'audio/aac',
  ],
  outputs: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'mp4', 'mov', 'webm', 'mkv'],
  limits: {
    server: {
      free: { maxBytes: 1024 ** 3, maxDurationSec: 60 * 60 },
      paid: { maxBytes: 4 * 1024 ** 3, maxDurationSec: 4 * 60 * 60 },
    },
    // A few passes of ffmpeg; afftdn alone runs about 50 times real time.
    timeoutSec: 60 * 60,
    maxConcurrent: 2,
  },
  cost: { kind: 'perMinute', credits: 1, minCredits: 1 },
  surfaces: ['web', 'mobile', 'panel', 'api'],
  seo: {
    title: 'Remove Background Noise from Audio Online | EditToolbelt',
    description:
      'Clean up speech: reduce background noise, hiss and 50 or 60 Hz hum in audio or a video’s sound. Compare before and after on a free 10-second preview first.',
    h1: 'Remove Background Noise from Audio',
    primaryQuery: 'remove background noise from audio',
    secondaryQueries: ['noise reduction online', 'clean up voice recording'],
    howTo: [
      'Drop a voice recording (MP3, WAV, FLAC, OGG, M4A) or a video.',
      'Pick a strength, and turn on de-hum at 50 or 60 Hz if you hear mains hum.',
      'Preview 10 seconds for free and switch between Original and Cleaned.',
      'Clean the whole file on our servers. A video gets its cleaned sound back in the browser, with the picture untouched.',
    ],
    faq: [
      {
        q: 'How does it remove the noise?',
        a: 'It measures the background in the quiet gaps between words, then an FFT noise filter (ffmpeg’s afftdn) lowers everything at or under that level, by up to 12, 24 or 40 dB for Light, Medium and Strong. A gentle high-pass takes out rumble under 60 Hz. It works best on steady noise: hiss, fans, air conditioning, traffic hum.',
      },
      {
        q: 'Which strength should I pick?',
        a: 'Start with Medium and listen to the preview. Light keeps the most of the voice and leaves some noise. Strong takes out the most, but can make the voice thinner and leave a faint watery sound in very noisy recordings.',
      },
      {
        q: 'What do de-hum and de-ess do?',
        a: 'De-hum cuts narrow notches at the mains frequency and its harmonics, up to 400 Hz for 50 Hz (Europe, Asia, Africa) or 480 Hz for 60 Hz (the Americas). De-ess softens sharp s sounds by about 5 dB, and leaves everything under 3 kHz alone.',
      },
      {
        q: 'Does it change the length or the level?',
        a: 'The result has exactly as many samples as the original, so a video stays in sync. The level only changes if the peaks would go over −1 dBTP; then the whole file is turned down just enough, and the notes say by how much.',
      },
      {
        q: 'What happens with a video?',
        a: 'Your browser reads the sound out of the video and sends only that, as lossless FLAC. Our servers clean it, and your browser puts it back into the same video, copying the picture without re-encoding it.',
      },
    ],
  },
  related: ['normalize-audio', 'remove-silence', 'transcribe-audio'],
  willDo: [
    'Reduce background noise, hum and hiss in speech at Light, Medium or Strong strength',
    'Remove 50 or 60 Hz mains hum, and clean the sound of a video without uploading the video',
    'Compare before and after on a free 10-second A/B preview',
  ],
});
