/**
 * Copy for conversion pair pages (docs/09 → URL scheme): each pair page is its
 * converter preset to that input and output, plus copy written for the pair:
 * what the formats are, when you'd convert, and what changes. No spun text:
 * every pair's copy is its own (docs/09 → Quality rules).
 *
 * A pair gets a page once its tool works; the registry tests check that every
 * such pair has copy here.
 */

export interface PairCopy {
  /** <title>: the search phrase first, brand last. */
  title: string;
  /** Meta description, ≤ 155 characters. */
  description: string;
  h1: string;
  /** One line under the H1. */
  tagline: string;
  /** "About …" section: 2-4 short paragraphs. */
  about: string[];
  /** 3-5 steps. */
  howTo: string[];
  /** 3-6 real questions. */
  faq: { q: string; a: string }[];
}

export const PAIR_COPY: Readonly<Partial<Record<string, PairCopy>>> = {
  'srt-to-vtt': {
    title: 'SRT to VTT Converter, Free and in Your Browser | EditToolbelt',
    description:
      'Convert SRT subtitles to WebVTT for HTML5 video, Vimeo and web players. Italics kept, times exact to the millisecond, and files never leave your device.',
    h1: 'SRT to VTT Converter',
    tagline: 'Turn SRT subtitles into WebVTT for HTML5 video and web players, one file or a batch.',
    about: [
      'SRT (SubRip) is the most common subtitle file: numbered cues, times with a comma before the milliseconds, and plain text with optional <i>, <b> and <u>. WebVTT is the format browsers read natively through the <track> element, and the one Vimeo, JW Player and most web players prefer.',
      'Timing and text convert exactly: the WEBVTT header is added, the comma in each time becomes a dot, and characters like & and < are escaped. Italic, bold and underline carry over unchanged.',
      'Some SRT files carry things WebVTT can’t hold, such as <font color> tags and position codes like {\\an8}. Those are removed, and the result tells you how many.',
    ],
    howTo: [
      'Drop one or more .srt files, or choose them. Several at once work.',
      'VTT is already selected. Keep italic and bold, or remove them.',
      'Select Convert. Each file converts on your device in a fraction of a second.',
      'Download the .vtt file, or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'Will my timings change?',
        a: 'No. SRT and WebVTT both store milliseconds, so 00:01:02,345 becomes 00:01:02.345 exactly.',
      },
      {
        q: 'How do I add the VTT file to an HTML5 video?',
        a: 'Put it next to the video and add <track kind="subtitles" src="captions.vtt" srclang="en" label="English"> inside the <video> element. The file must be served as UTF-8, which is what this tool writes.',
      },
      {
        q: 'What happens to Cyrillic or accented text?',
        a: 'The tool reads UTF-8, UTF-16 and the older Windows-1251 and Windows-1252 code pages, and always writes UTF-8, so the letters come out right in every browser.',
      },
    ],
  },
  'vtt-to-srt': {
    title: 'VTT to SRT Converter, Free and in Your Browser | EditToolbelt',
    description:
      'Convert WebVTT captions to SRT for Premiere Pro, DaVinci Resolve, Final Cut and TVs. Cue settings and speaker tags are removed and counted.',
    h1: 'VTT to SRT Converter',
    tagline: 'Turn WebVTT captions into SRT for editing apps and players, one file or a batch.',
    about: [
      'WebVTT (.vtt) is the caption format of the web: YouTube, Zoom and most online players export it. SRT is what editing apps and TVs read most reliably, from Premiere Pro and DaVinci Resolve to VLC and smart-TV players.',
      'Text and times convert exactly. What SRT can’t hold is removed and counted in the result: position and alignment settings after the times, speaker tags like <v Anna> (the words stay), class tags, and the word timestamps some automatic captions use.',
      'Cues are numbered from 1, and HTML entities such as &amp; become the plain characters.',
    ],
    howTo: [
      'Drop one or more .vtt files, or choose them.',
      'SRT is already selected.',
      'Select Convert, then read What changed to see which WebVTT features were removed.',
      'Download the .srt file, or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'Will Premiere Pro import the result?',
        a: 'Yes. Premiere Pro, DaVinci Resolve and Final Cut Pro all import SRT. Premiere reads it as a captions track you can restyle.',
      },
      {
        q: 'Why do YouTube automatic captions repeat lines?',
        a: 'Automatic captions roll: each cue repeats the line before it, with a timestamp per word. The timestamps are removed, but the rolling lines stay because they are part of the text. To get clean cues, download the captions as SRT from YouTube Studio instead.',
      },
      {
        q: 'What happens to caption positions?',
        a: 'SRT has no standard way to place a cue, so line and position settings are removed and the result counts them. Players then show every cue at the bottom.',
      },
    ],
  },
  'ass-to-srt': {
    title: 'ASS to SRT Converter, Keeps Italics | EditToolbelt',
    description:
      'Convert ASS and SSA subtitles to SRT. Line breaks and italics are kept, styling and effects are removed, and the result tells you exactly what was dropped.',
    h1: 'ASS to SRT Converter',
    tagline: 'Turn ASS or SSA subtitles into plain SRT, with italics and line breaks kept.',
    about: [
      'ASS (Advanced SubStation Alpha) and the older SSA are the formats of fansubs and Aegisub typesetting: named styles, fonts, colors, positions and animated effects. SRT holds only timed text with italic, bold and underline, which is why TVs, phones and editing apps all read it.',
      'Each Dialogue line becomes an SRT cue, sorted by time. \\N line breaks are kept, {\\i1} italics become <i> tags, and lines in an italic style are wrapped in <i>. Positions, colors, fonts, fades and other overrides are removed and counted, along with comment lines and vector drawings.',
      'ASS stores time in hundredths of a second, so the SRT times end in a zero: 0:00:01.25 becomes 00:00:01,250.',
    ],
    howTo: [
      'Drop one or more .ass or .ssa files, or choose them.',
      'SRT is already selected. Keep italic and bold, or remove every tag for players that show them as text.',
      'Select Convert, then read What changed to see how many overrides were removed.',
      'Download the .srt file, or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'Why are some lines missing?',
        a: 'Comment lines and vector drawings ({\\p1}) have no text to show, so they are skipped and counted. Every Dialogue line with text becomes a cue.',
      },
      {
        q: 'What happens to signs and typesetting?',
        a: 'Signs placed with positions and effects become plain text at the bottom of the screen, since SRT can’t place text. They keep their timing.',
      },
      {
        q: 'Does it handle Cyrillic and other scripts?',
        a: 'Yes. The tool reads UTF-8, UTF-16, Windows-1251 and Windows-1252, and writes UTF-8.',
      },
    ],
  },
};
