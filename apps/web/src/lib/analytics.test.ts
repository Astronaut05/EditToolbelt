import { afterEach, describe, expect, it, vi } from 'vitest';

import { collector, EVENT_NAMES, optedOut, payload, reportedPath } from './analytics';

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

  it('reports public pages and no personal page', () => {
    for (const path of ['/', '/photo', '/remove-background', '/convert/png-to-jpg', '/privacy']) {
      expect(reportedPath(path)).toBe(path);
    }
    for (const path of [
      '/admin',
      '/admin/users/0199a0d4-7c2e-7000-8000-000000000000',
      '/admin/jobs/0199a0d4-7c2e-7000-8000-000000000001',
      '/account',
      '/account/data',
      '/connect',
      '/credits/buy',
      '/credits/return',
      '/sign-in',
    ]) {
      expect(reportedPath(path), path).toBeNull();
    }
    // Only whole segments: a public page that starts with the same letters is reported.
    expect(reportedPath('/admins-guide')).toBe('/admins-guide');
  });
});

describe('analytics in the browser, with a collector configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** The bodies sent for one page view and one Web Vital on `pathname`. */
  async function sentFrom(pathname: string): Promise<string[]> {
    vi.stubEnv('ANALYTICS_URL', 'https://stats.example.com');
    vi.stubEnv('ANALYTICS_WEBSITE_ID', 'site');
    const bodies: string[] = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', { hostname: 'edit.example.com', pathname });
    vi.stubGlobal('navigator', { language: 'en-GB', doNotTrack: null });
    vi.stubGlobal('document', { referrer: '' });
    vi.stubGlobal('screen', { width: 1440, height: 900 });
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return Promise.resolve(new Response(null));
    });
    vi.resetModules();
    const { analyticsEnabled, track, trackPageview } = await import('./analytics');
    expect(analyticsEnabled).toBe(true);
    trackPageview();
    track('web_vital', { name: 'LCP', rating: 'good', page: pathname });
    return bodies;
  }

  it('sends page views and vitals from public pages', async () => {
    const bodies = await sentFrom('/remove-background');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('"url":"/remove-background"');
  });

  it('sends nothing from an admin page that names a user', async () => {
    expect(await sentFrom('/admin/users/0199a0d4-7c2e-7000-8000-000000000000')).toEqual([]);
    expect(await sentFrom('/account')).toEqual([]);
  });
});
