import { defineTool } from '../../define';

export default defineTool({
  id: 'subtitle-converter',
  code: 'T01',
  slug: 'subtitle-converter',
  category: 'subtitles-time',
  name: 'Subtitle Converter',
  tagline: 'Convert subtitle files between SRT, WebVTT, ASS/SSA, SBV and plain text.',
  summary: 'SRT, VTT, ASS and SBV, in batches',
  status: 'live',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'form',
  accepts: ['.srt', '.vtt', '.webvtt', '.ass', '.ssa', '.sbv'],
  outputs: ['srt', 'vtt', 'ass', 'sbv', 'txt'],
  batch: true,
  limits: { client: { maxBytes: 20 * 1024 * 1024 } },
  cost: { kind: 'free' },
  surfaces: ['web', 'panel'],
  seo: {
    title: 'Subtitle Converter, SRT, VTT, ASS and SBV | EditToolbelt',
    description:
      'Convert SRT, WebVTT, ASS/SSA, SBV and TXT subtitles, one file or a batch. See exactly what the new format drops, and get clean UTF-8 files back.',
    h1: 'Subtitle Converter',
    primaryQuery: 'subtitle converter',
    secondaryQueries: ['srt to vtt', 'vtt to srt', 'ass to srt'],
    howTo: [
      'Drop one or more subtitle files: SRT, VTT, ASS, SSA or SBV. The format is detected from the content.',
      'Pick the format to convert to, and whether to keep italic and bold.',
      'Select Convert. Files are converted on your device, one after another.',
      'Check What changed, then download the file, or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'Which subtitle formats can it convert?',
        a: 'It reads SRT, WebVTT, ASS, SSA and YouTube SBV, and writes SRT, WebVTT, ASS, SBV and plain text. The input format is detected from the file itself, not only its name.',
      },
      {
        q: 'What gets lost when converting?',
        a: 'Only what the new format can’t hold, and the result lists it: “12 style overrides removed”, “3 cue position settings removed”. Text and line breaks are always kept, and times are exact to the millisecond, except in ASS, which stores hundredths.',
      },
      {
        q: 'My subtitles show strange characters. What do I do?',
        a: 'Old files are often in a legacy code page. The tool detects UTF-8, UTF-16, Windows-1251 (Cyrillic) and Windows-1252 (Western); if the preview still looks wrong, set Read as to 1251 or 1252 and convert again. The output is always UTF-8.',
      },
      {
        q: 'Can I convert a whole season at once?',
        a: 'Yes. Drop all the files together; each one is converted and listed with its result, and Download all gives you one ZIP.',
      },
      {
        q: 'What does SRT to ASS look like?',
        a: 'Every cue uses one default style: white Arial, 64 px on a 1920 × 1080 canvas, with a black outline, at the bottom centre. Open the file in Aegisub to change the style.',
      },
    ],
  },
  related: ['subtitle-shift', 'subtitle-editor', 'burn-subtitles'],
  willDo: [
    'Convert between SRT, WebVTT, ASS/SSA, SBV and plain text, one file or a whole batch',
    'Keep line breaks from ASS to SRT, and turn italic overrides into <i> tags if you want',
    'Report anything the new format cannot hold, such as "12 style overrides removed"',
  ],
});
