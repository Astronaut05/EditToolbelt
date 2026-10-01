import { describe, expect, it } from 'vitest';

import {
  PLATFORMS,
  SOCIAL_PRESETS,
  socialLabel,
  socialPreset,
  socialPresetsOf,
} from './social-presets';

describe('social presets', () => {
  it('has unique ids, whole sizes and a check date for every size', () => {
    const ids = SOCIAL_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of SOCIAL_PRESETS) {
      expect(preset.id).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
      expect(preset.id.startsWith(`${preset.platform}-`)).toBe(true);
      expect(Number.isInteger(preset.width) && preset.width > 0).toBe(true);
      expect(Number.isInteger(preset.height) && preset.height > 0).toBe(true);
      expect(preset.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(preset.verifiedOn))).toBe(false);
    }
  });

  it('covers every platform the spec names, with its sizes', () => {
    for (const platform of PLATFORMS) {
      expect(SOCIAL_PRESETS.some((preset) => preset.platform === platform)).toBe(true);
    }
    const size = (id: string) => {
      const preset = socialPreset(id);
      return preset && `${String(preset.width)}x${String(preset.height)}`;
    };
    expect(size('instagram-square')).toBe('1080x1080');
    expect(size('instagram-portrait')).toBe('1080x1350');
    expect(size('instagram-story')).toBe('1080x1920');
    expect(size('youtube-thumbnail')).toBe('1280x720');
    expect(size('youtube-banner')).toBe('2560x1440');
    expect(size('tiktok-cover')).toBe('1080x1920');
    expect(size('x-post')).toBe('1600x900');
    expect(size('x-header')).toBe('1500x500');
    expect(size('linkedin-post')).toBe('1200x627');
    expect(size('linkedin-banner')).toBe('1584x396');
    expect(size('pinterest-pin')).toBe('1000x1500');
    expect(socialPreset('facebook-cover')).toBeDefined();
  });

  it('reads a list of ids in table order, without unknown ids or repeats', () => {
    expect(
      socialPresetsOf('x-post, instagram-square,nope,x-post').map((preset) => preset.id),
    ).toEqual(['instagram-square', 'x-post']);
    expect(socialPresetsOf('')).toEqual([]);
    expect(socialPresetsOf(undefined)).toEqual([]);
  });

  it('labels a size with its platform', () => {
    const preset = socialPreset('youtube-thumbnail');
    expect(preset && socialLabel(preset)).toBe('YouTube · Thumbnail');
  });
});
