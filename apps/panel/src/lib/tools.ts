/**
 * Where each of the panel's tools runs (docs/01 → Premiere panel: a thin
 * client over the API, plus pure calculators from core): on our servers
 * (uploaded and run as a job), in the panel itself (core's calculators and
 * text tools), on the website (the browser media tools the panel can't run),
 * or not yet.
 */
import type { Tool } from '@etb/core/api';

export type Place = 'server' | 'panel' | 'website' | 'soon';

/** The tools the panel runs itself: calculators, and text files (subtitles, LUTs). */
export const PANEL_TOOLS: Record<string, 'calculator' | 'file'> = {
  'timecode-calculator': 'calculator',
  'aspect-ratio-calculator': 'calculator',
  'bitrate-calculator': 'calculator',
  'color-converter': 'calculator',
  'subtitle-converter': 'file',
  'subtitle-shift': 'file',
  'lut-converter': 'file',
};

export function placeOf(tool: Tool): Place {
  if (tool.status === 'soon' || tool.status === 'disabled' || tool.maintenance) return 'soon';
  if (tool.server) return 'server';
  if (Object.hasOwn(PANEL_TOOLS, tool.id)) return 'panel';
  return 'website';
}

export const PLACE_LABELS: Record<Place, string> = {
  server: 'Run on our servers',
  panel: 'In the panel',
  website: 'On the website',
  soon: 'Coming soon',
};

/** The tools in the panel's order: by where they run, then by name. */
export function grouped(tools: readonly Tool[]): { place: Place; tools: Tool[] }[] {
  const order: Place[] = ['server', 'panel', 'website', 'soon'];
  return order
    .map((place) => ({
      place,
      tools: tools
        .filter((tool) => placeOf(tool) === place)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.tools.length > 0);
}

/** What a tool costs, in words: "Free", "3 credits", "2 credits a minute". */
export function costLabel(tool: Pick<Tool, 'cost'>): string {
  const rule = tool.cost;
  const credits = (n: number) => `${String(n)} ${n === 1 ? 'credit' : 'credits'}`;
  switch (rule.kind) {
    case 'free':
      return 'Free';
    case 'flat':
      return credits(rule.credits);
    case 'perMinute':
      return `${credits(rule.credits)} a minute, at least ${String(rule.minCredits)}`;
    case 'perMegapixel':
      return `${credits(rule.credits)} a megapixel, at least ${String(rule.minCredits)}`;
  }
}

/**
 * A result's file name, made in the panel from the clip's (docs/06 → Panel):
 * "Interview A.mov" run through VFR to CFR is "Interview A_vfr-to-cfr.mp4".
 */
export function resultName(clipName: string, toolId: string, ext: string): string {
  const dot = clipName.lastIndexOf('.');
  const stem = (dot > 0 ? clipName.slice(0, dot) : clipName)
    // Characters Windows and macOS can't take in a file name.
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  return `${stem || 'clip'}_${toolId}.${ext.replace(/^\./, '') || 'bin'}`;
}
