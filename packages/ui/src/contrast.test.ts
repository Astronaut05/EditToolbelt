import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkContrast, contrast, parseTokens } from './contrast';

const table = parseTokens(readFileSync(new URL('../tokens.css', import.meta.url), 'utf8'));
const results = checkContrast(table);

function ratio(theme: 'light' | 'dark', fg: string, bg: string): number {
  const found = results.find((r) => r.theme === theme && r.fg === fg && r.bg === bg);
  if (!found) throw new Error(`${theme} ${fg}/${bg} not checked`);
  return Math.round(found.ratio * 10) / 10;
}

describe('token contrast (WCAG 2.2 AA)', () => {
  it.each(results.map((r) => [`${r.theme} --${r.fg} on --${r.bg}`, r] as const))(
    '%s passes',
    (_name, result) => {
      expect(
        result.ratio,
        `${result.ratio.toFixed(2)} < ${String(result.min)}`,
      ).toBeGreaterThanOrEqual(result.min);
    },
  );

  // docs/design/README.md → Contrast check. The handover rounds some values
  // differently (e.g. 5.9 vs 5.8 for --text-muted on --bg in dark), so these
  // allow ±0.15.
  it.each([
    ['dark', 'text', 'bg', 17.7],
    ['light', 'text', 'bg', 19.8],
    ['dark', 'text-muted', 'bg', 5.9],
    ['light', 'text-muted', 'bg', 5.3],
    ['dark', 'text-muted', 'surface', 5.6],
    ['light', 'text-muted', 'surface', 4.9],
    ['dark', 'accent-contrast', 'accent', 13.0],
    ['light', 'accent-contrast', 'accent', 5.8],
    ['dark', 'danger', 'bg', 7.1],
    ['light', 'danger', 'bg', 5.8],
    ['dark', 'warning', 'bg', 10.7],
    ['light', 'warning', 'bg', 5.9],
    ['dark', 'border-field', 'bg', 3.7],
    ['light', 'border-field', 'bg', 3.7],
    ['dark', 'border-field', 'surface', 3.5],
    ['light', 'border-field', 'surface', 3.4],
  ] as const)('%s --%s on --%s reproduces the handover (%s)', (theme, fg, bg, expected) => {
    expect(Math.abs(ratio(theme, fg, bg) - expected)).toBeLessThanOrEqual(0.15);
  });

  it('computes known reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});
