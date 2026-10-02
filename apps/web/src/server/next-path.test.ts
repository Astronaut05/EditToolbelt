import { describe, expect, it, vi } from 'vitest';

import { safeNext } from './next-path';

vi.mock('./env', () => ({ serverEnv: () => ({ SITE_URL: 'https://site.test' }) }));

describe('safeNext', () => {
  it('keeps paths on this site, with their query and fragment', () => {
    expect(safeNext('/admin/tools')).toBe('/admin/tools');
    expect(safeNext('/connect?code=BCDF-GHJK')).toBe('/connect?code=BCDF-GHJK');
    expect(safeNext('/tools/compress-video?from=%2Faccount#offer')).toBe(
      '/tools/compress-video?from=%2Faccount#offer',
    );
    expect(safeNext('/a/./b/../c')).toBe('/a/c');
    expect(safeNext('/', '/x')).toBe('/');
  });

  it('refuses other origins and schemes', () => {
    for (const next of [
      'https://evil.example',
      'http://site.test.evil.example/',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,hi',
      '//evil.example',
      '///evil.example',
      'evil.example',
      ' /account',
    ]) {
      expect(safeNext(next), JSON.stringify(next)).toBe('/account');
    }
  });

  it('refuses what a browser reads as another origin: control characters, backslashes, dot segments', () => {
    for (const next of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r\n/evil.example',
      '/\t\t/evil.example',
      '\t//evil.example',
      '/\u0000/evil.example',
      '/\u007f/evil.example',
      '/\u0085/evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '\\\\evil.example',
      '/.//evil.example',
      '/..//evil.example',
      '/a/../..//evil.example',
    ]) {
      expect(safeNext(next), JSON.stringify(next)).toBe('/account');
    }
  });

  it('refuses the encoded forms of the same tricks', () => {
    for (const next of [
      '/%09/evil.example',
      '/%0a/evil.example',
      '/%0D%0A/evil.example',
      '/%2F/evil.example',
      '/%2fevil.example',
      '/%5Cevil.example',
      '/%5c/evil.example',
      '/%252F/evil.example',
      '/%2e/%2fevil.example',
      '/%',
    ]) {
      expect(safeNext(next), JSON.stringify(next)).toBe('/account');
    }
  });

  it('falls back for anything that isn’t a string, or is absurdly long', () => {
    expect(safeNext(undefined)).toBe('/account');
    expect(safeNext(null, '/')).toBe('/');
    expect(safeNext(42)).toBe('/account');
    expect(safeNext(['/admin'])).toBe('/account');
    expect(safeNext('')).toBe('/account');
    expect(safeNext(`/${'a'.repeat(3000)}`)).toBe('/account');
  });

  it('judges against the site it is given', () => {
    expect(safeNext('/x', '/account', 'http://localhost:3000')).toBe('/x');
    expect(safeNext('//localhost:3001/x', '/account', 'http://localhost:3000')).toBe('/account');
  });
});
