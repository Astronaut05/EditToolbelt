/**
 * Social media image sizes (tools/photo.md → P13), shared by the tool page,
 * its engine and the panel. Platforms change these: every size carries the
 * date it was last checked (`verifiedOn`, the spec's `verified_on`), and the
 * table is reviewed every quarter (docs/DECISIONS.md → P13).
 */

export const PLATFORMS = [
  'instagram',
  'youtube',
  'tiktok',
  'x',
  'linkedin',
  'facebook',
  'pinterest',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
};

export interface SocialPreset {
  /** Stable: kept in links and file names. */
  id: string;
  platform: Platform;
  /** What it's for, without the platform: "Post, portrait". */
  name: string;
  width: number;
  height: number;
  /** The platform's upload limit in bytes, when it has one the file must stay under. */
  maxBytes?: number;
  /** What to keep in mind: where the platform covers or crops the image. */
  note?: string;
  /** ISO date the size was last checked. */
  verifiedOn: string;
}

const CHECKED = '2026-10-01';

export const SOCIAL_PRESETS: readonly SocialPreset[] = [
  {
    id: 'instagram-square',
    platform: 'instagram',
    name: 'Post, square',
    width: 1080,
    height: 1080,
    verifiedOn: CHECKED,
  },
  {
    id: 'instagram-portrait',
    platform: 'instagram',
    name: 'Post, portrait 4:5',
    width: 1080,
    height: 1350,
    note: 'The profile grid shows it a little trimmed at the top and bottom',
    verifiedOn: CHECKED,
  },
  {
    id: 'instagram-grid',
    platform: 'instagram',
    name: 'Post, 3:4',
    width: 1080,
    height: 1440,
    note: 'Shows whole in the profile grid',
    verifiedOn: CHECKED,
  },
  {
    id: 'instagram-story',
    platform: 'instagram',
    name: 'Story, Reel cover',
    width: 1080,
    height: 1920,
    note: 'Keep text out of the top and bottom 250 px',
    verifiedOn: CHECKED,
  },
  {
    id: 'youtube-thumbnail',
    platform: 'youtube',
    name: 'Thumbnail',
    width: 1280,
    height: 720,
    maxBytes: 2_000_000,
    verifiedOn: CHECKED,
  },
  {
    id: 'youtube-banner',
    platform: 'youtube',
    name: 'Channel banner',
    width: 2560,
    height: 1440,
    maxBytes: 6_000_000,
    note: 'Phones show only the middle 1546 × 423 px',
    verifiedOn: CHECKED,
  },
  {
    id: 'tiktok-cover',
    platform: 'tiktok',
    name: 'Video cover, photo post',
    width: 1080,
    height: 1920,
    note: 'Buttons and captions cover the right edge and the bottom',
    verifiedOn: CHECKED,
  },
  {
    id: 'x-post',
    platform: 'x',
    name: 'Post',
    width: 1600,
    height: 900,
    maxBytes: 5_000_000,
    verifiedOn: CHECKED,
  },
  {
    id: 'x-header',
    platform: 'x',
    name: 'Header',
    width: 1500,
    height: 500,
    note: 'Your profile photo covers part of the bottom left',
    verifiedOn: CHECKED,
  },
  {
    id: 'linkedin-post',
    platform: 'linkedin',
    name: 'Post',
    width: 1200,
    height: 627,
    verifiedOn: CHECKED,
  },
  {
    id: 'linkedin-banner',
    platform: 'linkedin',
    name: 'Profile banner',
    width: 1584,
    height: 396,
    note: 'Your profile photo covers part of the left side',
    verifiedOn: CHECKED,
  },
  {
    id: 'linkedin-company',
    platform: 'linkedin',
    name: 'Company page cover',
    width: 1128,
    height: 191,
    verifiedOn: CHECKED,
  },
  {
    id: 'facebook-cover',
    platform: 'facebook',
    name: 'Page cover',
    width: 851,
    height: 315,
    note: 'Phones crop the sides: keep faces and text in the middle',
    verifiedOn: CHECKED,
  },
  {
    id: 'pinterest-pin',
    platform: 'pinterest',
    name: 'Pin',
    width: 1000,
    height: 1500,
    verifiedOn: CHECKED,
  },
];

const BY_ID = new Map(SOCIAL_PRESETS.map((preset) => [preset.id, preset]));

export function socialPreset(id: string): SocialPreset | undefined {
  return BY_ID.get(id);
}

/**
 * The sizes in a comma-separated list of ids ("instagram-square,x-post"), in
 * table order, without unknown ids or repeats.
 */
export function socialPresetsOf(ids: string | undefined): SocialPreset[] {
  const wanted = new Set((ids ?? '').split(',').map((id) => id.trim()));
  return SOCIAL_PRESETS.filter((preset) => wanted.has(preset.id));
}

/** "Instagram · Post, square". */
export function socialLabel(preset: SocialPreset): string {
  return `${PLATFORM_NAMES[preset.platform]} · ${preset.name}`;
}
