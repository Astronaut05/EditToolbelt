import { defineTool } from '../../define';

export default defineTool({
  id: 'normalize-audio',
  code: 'A05',
  slug: 'normalize-audio',
  category: 'audio',
  name: 'Normalize Loudness',
  tagline: 'Hit a loudness target like -14 LUFS for YouTube, with a -1 dBTP true-peak ceiling.',
  summary: 'Hit -14, -16, -23 or -24 LUFS',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['audio-dsp'],
  ui: 'form',
  batch: false,
  accepts: ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac'],
  outputs: ['wav', 'flac', 'mp3', 'm4a', 'ogg'],
  limits: { client: { maxBytes: 1024 ** 3, maxDurationSec: 4 * 60 * 60 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Normalize Audio, Hit -14 LUFS or Any Target | EditToolbelt',
    description:
      'Set integrated loudness to -14 LUFS for YouTube, -16 LUFS for podcasts, -23 LUFS for EBU R128 or your own target, with true peak under -1 dBTP by default.',
    h1: 'Normalize Audio',
    primaryQuery: 'normalize audio',
    secondaryQueries: ['lufs normalizer', 'normalize to -14 lufs', 'make audio louder'],
    howTo: [
      'Drop an audio file: MP3, WAV, FLAC, OGG or M4A.',
      'Pick a target: −14 LUFS for YouTube and streaming, −16 for podcasts, −23 for EBU R128, −24 for US TV, or your own.',
      'Keep the true-peak ceiling at −1 dBTP unless a spec asks for another, and keep Gain + limiter on to always reach the target.',
      'Normalize it. The result is measured again, from the file you download.',
    ],
    faq: [
      {
        q: 'What does it do to my audio?',
        a: 'It measures the integrated loudness, then turns the whole file up or down by one amount to reach the target. Nothing else changes, unless the peaks would go over the ceiling.',
      },
      {
        q: 'When does the limiter act?',
        a: 'Only when the gain would push a peak over the ceiling. It looks 5 ms ahead and lowers just those peaks, measured four times between the samples, then recovers over about 80 ms. The notes say how much it took off. With Gain only, the gain stops where the peaks reach the ceiling instead.',
      },
      {
        q: 'What target should I use?',
        a: 'YouTube, Spotify and most streaming: −14 LUFS. Podcasts: −16 LUFS. European broadcast (EBU R128): −23 LUFS. US film and TV (ATSC A/85): −24 LKFS, the same scale. A true peak of −1 dBTP leaves room for MP3 and AAC encoding.',
      },
      {
        q: 'Is the result exact?',
        a: 'Within 0.5 LU of the target, and usually within 0.1. MP3 and M4A are measured from the encoded file, as encoding can move the peaks a little; if it does, the notes say so.',
      },
    ],
  },
  related: ['loudness-meter', 'remove-noise', 'audio-converter'],
  willDo: [
    'Presets for streaming -14 LUFS, podcasts -16 LUFS, EBU R128 -23 LUFS and US film/TV -24 LKFS',
    'Measure with ITU-R BS.1770 gating, then apply gain only, or gain plus a true-peak limiter',
    'Keep true peak under the ceiling you set, -1 dBTP by default',
  ],
});
