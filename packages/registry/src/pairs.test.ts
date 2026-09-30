import { describe, expect, it } from 'vitest';

import { conversions, livePairs, PAIR_COPY } from './index';

describe('conversion pair copy (docs/09 → URL scheme, Quality rules)', () => {
  it('every pair with a page has its own copy', () => {
    const missing = livePairs()
      .filter((pair) => !PAIR_COPY[pair.slug])
      .map((pair) => pair.slug);
    expect(missing).toEqual([]);
  });

  it('copy belongs to a real pair and fits the template', () => {
    const slugs = new Set(conversions.map((pair) => pair.slug));
    for (const [slug, copy] of Object.entries(PAIR_COPY)) {
      if (!copy) continue;
      expect(slugs.has(slug), slug).toBe(true);
      expect(copy.title.length, `${slug} title`).toBeLessThanOrEqual(70);
      expect(copy.description.length, `${slug} description`).toBeLessThanOrEqual(155);
      expect(copy.about.length, `${slug} about`).toBeGreaterThanOrEqual(2);
      expect(copy.about.length, `${slug} about`).toBeLessThanOrEqual(4);
      expect(copy.howTo.length, `${slug} howTo`).toBeGreaterThanOrEqual(3);
      expect(copy.howTo.length, `${slug} howTo`).toBeLessThanOrEqual(5);
      expect(copy.faq.length, `${slug} faq`).toBeGreaterThanOrEqual(3);
      expect(copy.faq.length, `${slug} faq`).toBeLessThanOrEqual(6);
      const all = [
        copy.title,
        copy.description,
        copy.h1,
        copy.tagline,
        ...copy.about,
        ...copy.howTo,
        ...copy.faq.flatMap((item) => [item.q, item.a]),
      ];
      // docs/03 → Copy: no em or en dashes.
      for (const line of all) expect(line, slug).not.toMatch(/[–—]/);
    }
  });

  it('pages differ from each other (no near-duplicates)', () => {
    const abouts = Object.values(PAIR_COPY).map((copy) => copy?.about.join(' ') ?? '');
    expect(new Set(abouts).size).toBe(abouts.length);
  });
});
