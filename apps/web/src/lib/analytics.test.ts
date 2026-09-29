import { describe, expect, it } from 'vitest';

import { collector, EVENT_NAMES, optedOut, payload } from './analytics';

const page = {
  hostname: 'edit.example.com',
  pathname: '/remove-background',
  referrer: 'https://search.example.org/some/path?q=secret',
  language: 'en-GB',
  screen: '1440x900',
};

describe('analytics', () => {
  it('is off unless both settings are present', () => {
    expect(collector({})).toBeNull();
    expect(collector({ url: 'https://stats.example.com' })).toBeNull();
    expect(collector({ url: 'https://stats.example.com/', website: 'id' })).toEqual({
      url: 'https://stats.example.com',
      website: 'id',
    });
  });

  it('sends the referrer as an origin only, and no query strings', () => {
    const body = payload({ url: 'https://stats.example.com', website: 'site' }, page, {
      name: 'tool_download',
      data: { tool_id: 'remove-background' },
    });
    expect(body.payload.referrer).toBe('https://search.example.org');
    expect(body.payload.url).toBe('/remove-background');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('drops internal referrers', () => {
    const body = payload(
      { url: 'x', website: 'site' },
      { ...page, referrer: 'https://edit.example.com/photo' },
    );
    expect(body.payload.referrer).toBe('');
  });

  it('respects Do Not Track and Global Privacy Control', () => {
    expect(optedOut({ doNotTrack: '1' })).toBe(true);
    expect(optedOut({ globalPrivacyControl: true })).toBe(true);
    expect(optedOut({ doNotTrack: null })).toBe(false);
  });

  it('covers the docs/09 event list', () => {
    expect(EVENT_NAMES).toContain('tool_run_failed');
    expect(EVENT_NAMES).toContain('signup_completed');
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });
});
