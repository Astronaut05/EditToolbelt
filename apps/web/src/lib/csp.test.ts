import { describe, expect, it } from 'vitest';

import { buildCsp } from './csp';
import { PADDLE_CSP } from './paddle-js';

const directive = (csp: string, name: string) =>
  csp.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';

describe('buildCsp', () => {
  it('allows no frames and no third-party script by default', () => {
    const csp = buildCsp({ nonce: 'abc' });
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
  });

  it('adds Paddle’s origins for the checkout page only when asked', () => {
    const csp = buildCsp({ nonce: 'abc', ...PADDLE_CSP });
    expect(directive(csp, 'script-src')).toContain(PADDLE_CSP.scripts[0]);
    expect(directive(csp, 'style-src')).toContain(PADDLE_CSP.styles[0]);
    expect(directive(csp, 'frame-src')).toBe(`frame-src ${PADDLE_CSP.frames.join(' ')}`);
    expect(directive(csp, 'connect-src')).toBe(`connect-src 'self' ${PADDLE_CSP.connect[0]}`);
    expect(csp).toContain("object-src 'none'");
  });
});
