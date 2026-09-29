/**
 * Self-hosted fonts (docs/03 → Tokens, docs/10 → Loading strategy): Onest
 * (variable) for the UI and IBM Plex Mono 400/500 for numbers and labels, from
 * the Fontsource packages, served from our own origin with hashed file names.
 *
 * One next/font call per subset, each limited by `unicode-range`, so a page
 * downloads only the subsets its text uses. Latin carries Uzbek oʻ gʻ (U+02BB)
 * and the ‘ quote (U+2018); Cyrillic-ext carries Uzbek қ ғ ҳ. Only the Latin
 * Onest file is preloaded (the UI font); the rest swap in.
 *
 * globals.css stacks the subsets narrowest first, with the Latin face and its
 * metric-matched fallback (which keeps layout shift near zero) last.
 *
 * next/font only accepts literal options, hence the repetition.
 */
import localFont from 'next/font/local';

const onestLatin = localFont({
  src: '../../node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-onest-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
  preload: true,
  adjustFontFallback: 'Arial',
});

const onestLatinExt = localFont({
  src: '../../node_modules/@fontsource-variable/onest/files/onest-latin-ext-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-onest-latin-ext',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
  ],
  preload: false,
  adjustFontFallback: false,
});

const onestCyrillic = localFont({
  src: '../../node_modules/@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-onest-cyrillic',
  declarations: [
    { prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  ],
  preload: false,
  adjustFontFallback: false,
});

const onestCyrillicExt = localFont({
  src: '../../node_modules/@fontsource-variable/onest/files/onest-cyrillic-ext-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-onest-cyrillic-ext',
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
    },
  ],
  preload: false,
  adjustFontFallback: false,
});

const plexLatin = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
      weight: '500',
    },
  ],
  display: 'swap',
  variable: '--font-plex-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
  preload: false,
  adjustFontFallback: false,
});

const plexLatinExt = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-500-normal.woff2',
      weight: '500',
    },
  ],
  display: 'swap',
  variable: '--font-plex-latin-ext',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
  ],
  preload: false,
  adjustFontFallback: false,
});

const plexCyrillic = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-500-normal.woff2',
      weight: '500',
    },
  ],
  display: 'swap',
  variable: '--font-plex-cyrillic',
  declarations: [
    { prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  ],
  preload: false,
  adjustFontFallback: false,
});

const plexCyrillicExt = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-ext-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-ext-500-normal.woff2',
      weight: '500',
    },
  ],
  display: 'swap',
  variable: '--font-plex-cyrillic-ext',
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
    },
  ],
  preload: false,
  adjustFontFallback: false,
});

/** Class names that define the per-subset font variables on <html>. */
export const fontVariables = [
  onestLatin,
  onestLatinExt,
  onestCyrillic,
  onestCyrillicExt,
  plexLatin,
  plexLatinExt,
  plexCyrillic,
  plexCyrillicExt,
]
  .map((font) => font.variable)
  .join(' ');
