/**
 * P10 Add Text to Image's fonts (docs/13 → Fontsource packages): five OFL
 * families, each checked to draw Uzbek Latin oʻ gʻ and Uzbek Cyrillic қ ғ ҳ ў.
 * Their files are copied into the build at /fonts/text/ (scripts/text-fonts.ts)
 * in four subsets, so a page loads only the subsets its text uses.
 */

export interface TextFont {
  id: string;
  label: string;
  /** The Fontsource package and file prefix. */
  pkg: string;
  file: string;
  /** One variable file per subset (Onest), or 400 and 700. */
  variable?: boolean;
}

export const TEXT_FONTS: readonly TextFont[] = [
  { id: 'onest', label: 'Onest', pkg: '@fontsource-variable/onest', file: 'onest', variable: true },
  { id: 'montserrat', label: 'Montserrat', pkg: '@fontsource/montserrat', file: 'montserrat' },
  { id: 'oswald', label: 'Oswald (condensed)', pkg: '@fontsource/oswald', file: 'oswald' },
  { id: 'noto-serif', label: 'Noto Serif', pkg: '@fontsource/noto-serif', file: 'noto-serif' },
  {
    id: 'plex-mono',
    label: 'IBM Plex Mono',
    pkg: '@fontsource/ibm-plex-mono',
    file: 'ibm-plex-mono',
  },
];

/** Fontsource's subsets and their unicode ranges (the same for every family here). */
export const TEXT_SUBSETS: readonly [string, string][] = [
  [
    'latin',
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  ],
  [
    'latin-ext',
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  ],
  ['cyrillic', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['cyrillic-ext', 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'],
];

export const TEXT_WEIGHTS = [400, 700] as const;

/** Where the copied files are served, on the site's own origin (font-src 'self'). */
export const TEXT_FONT_PATH = '/fonts/text/';

/** A font file's name: "montserrat-latin-700-normal.woff2", or Onest's one variable file per subset. */
export const fontFile = (font: TextFont, subset: string, weight: number) =>
  font.variable
    ? `${font.file}-${subset}-wght-normal.woff2`
    : `${font.file}-${subset}-${String(weight)}-normal.woff2`;

/** The family name a font is registered under, so it never clashes with the site's own Onest. */
export const textFamily = (id: string) => `etb-text-${id}`;
