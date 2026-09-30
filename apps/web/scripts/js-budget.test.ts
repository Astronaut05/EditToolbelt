import { describe, expect, it } from 'vitest';

import { moduleScripts } from './js-budget';

describe('js budget', () => {
  it('counts module scripts only', () => {
    const html =
      '<script src="/_next/a.js" async=""></script><script>inline()</script><script src="/_next/legacy.js" noModule=""></script><script src="/_next/b.js?x=1"></script>';
    expect(moduleScripts(html)).toEqual(['/_next/a.js', '/_next/b.js']);
  });
});
