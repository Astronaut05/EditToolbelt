/**
 * WCAG 2.2 contrast for the token table (docs/03 → Tokens: "CI runs a
 * contrast check on the token table"). Reads tokens.css, so the check can't
 * drift from the tokens the site uses.
 */

export type Theme = 'light' | 'dark';
export type TokenTable = Record<Theme, Record<string, string>>;

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) out[name] = value.replace(/\/\*.*?\*\//g, '').trim();
  }
  return out;
}

/** Light = the first `:root { … }`; dark = light overridden by `:root[data-theme=dark]` (either quote style). */
export function parseTokens(css: string): TokenTable {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light = /:root\s*\{([^}]*)\}/.exec(withoutComments)?.[1];
  const dark = /:root\[data-theme=["']dark["']\]\s*\{([^}]*)\}/.exec(withoutComments)?.[1];
  if (!light || !dark) throw new Error('tokens.css: light or dark block not found');
  const lightTokens = declarations(light);
  return { light: lightTokens, dark: { ...lightTokens, ...declarations(dark) } };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The pairs the design handover checked (docs/design/README.md → Contrast check). */
export const PAIRS = [
  { fg: 'text', bg: 'bg', min: 4.5 },
  { fg: 'text-muted', bg: 'bg', min: 4.5 },
  { fg: 'text-muted', bg: 'surface', min: 4.5 },
  { fg: 'accent-contrast', bg: 'accent', min: 4.5 },
  { fg: 'accent', bg: 'bg', min: 3 },
  { fg: 'danger', bg: 'bg', min: 4.5 },
  { fg: 'warning', bg: 'bg', min: 4.5 },
  { fg: 'focus-ring', bg: 'bg', min: 3 },
  { fg: 'border-strong', bg: 'bg', min: 3 },
  // Form fields' outline is their only boundary (WCAG 1.4.11); they sit on all three grounds.
  { fg: 'border-field', bg: 'bg', min: 3 },
  { fg: 'border-field', bg: 'surface', min: 3 },
  { fg: 'border-field', bg: 'surface-raised', min: 3 },
  { fg: 'media-text', bg: 'media-scrim-solid', min: 4.5 },
  { fg: 'media-text-muted', bg: 'media-scrim-solid', min: 4.5 },
  { fg: 'media-accent', bg: 'media-scrim-solid', min: 4.5 },
] as const;

export interface PairResult {
  theme: Theme;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/**
 * Media overlays are a translucent scrim over arbitrary pixels; the check uses
 * the worst case the scrim allows: 82 % #0A0A0A over pure white.
 */
function resolve(tokens: Record<string, string>, name: string): string {
  if (name === 'media-scrim-solid') return mix('#0A0A0A', '#FFFFFF', 0.82);
  const value = tokens[name];
  if (!value) throw new Error(`Unknown token --${name}`);
  return value;
}

function mix(top: string, under: string, alpha: number): string {
  const parse = (hex: string) => Number.parseInt(hex.slice(1), 16);
  const [t, u] = [parse(top), parse(under)];
  const c = (shift: number) =>
    Math.round(((t >> shift) & 255) * alpha + ((u >> shift) & 255) * (1 - alpha));
  return `#${[16, 8, 0].map((shift) => c(shift).toString(16).padStart(2, '0')).join('')}`;
}

export function checkContrast(table: TokenTable): PairResult[] {
  return (['dark', 'light'] as const).flatMap((theme) =>
    PAIRS.map(({ fg, bg, min }) => {
      const ratio = contrast(resolve(table[theme], fg), resolve(table[theme], bg));
      return { theme, fg, bg, ratio, min, pass: ratio >= min };
    }),
  );
}
