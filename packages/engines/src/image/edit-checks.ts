/**
 * The checks the ToolShell makes on the canvas editor's changes before a run:
 * P01's adjustments and P12's areas. They sit apart from the pixel code in
 * adjust.ts and redact.ts, so the shell, which every tool page loads, doesn't
 * carry that code (docs/DECISIONS.md → "The ToolShell loads tool-specific
 * parts only on the tools that use them").
 */
import type { Adjust } from './adjust';
import type { Redact } from './redact';

export const NO_ADJUST: Adjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};

export const isNeutral = (adjust: Adjust | undefined) =>
  !adjust || (Object.keys(NO_ADJUST) as (keyof Adjust)[]).every((key) => adjust[key] === 0);

/** The areas that hide something: drawn ones, and found faces not turned off. */
export const activeAreas = (redact: Redact) => redact.areas.filter((a) => !a.off);
