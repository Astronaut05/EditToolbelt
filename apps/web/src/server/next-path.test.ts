import { describe, expect, it } from 'vitest';

import { safeNext } from './next-path';

describe('safeNext', () => {
  it('keeps paths on this site and refuses anything else', () => {
    expect(safeNext('/admin/tools')).toBe('/admin/tools');
    expect(safeNext('https://evil.example')).toBe('/account');
    expect(safeNext('//evil.example')).toBe('/account');
    expect(safeNext('/\\evil.example')).toBe('/account');
    expect(safeNext(undefined)).toBe('/account');
    expect(safeNext(null, '/')).toBe('/');
  });
});
