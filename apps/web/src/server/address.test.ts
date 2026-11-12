import { describe, expect, it } from 'vitest';

import { addressKey } from './address';

describe('the key a rate limit counts an address under', () => {
  it('is an IPv4 address as it is', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('direct')).toBe('direct');
  });

  it('is an IPv6 address by its /64, however it is written', () => {
    const key = '2001:db8:1:2::/64';
    for (const address of [
      '2001:db8:1:2::1',
      '2001:db8:1:2:ffff:ffff:ffff:ffff',
      '2001:0db8:0001:0002:0000:0000:0000:0001',
      '2001:DB8:1:2::abcd',
      '[2001:db8:1:2::1]',
      '2001:db8:1:2::1%eth0',
    ]) {
      expect(addressKey(address), address).toBe(key);
    }
    // One subscriber's whole /64 is one caller; the next /64 is another.
    expect(addressKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('leaves what it cannot read as sent, without throwing', () => {
    for (const odd of ['not:an:address', '2001:db8', 'zz::1', '']) {
      expect(addressKey(odd), odd).toBe(odd);
    }
    // Nonsense still gets one key of its own, not a bucket per spelling.
    expect(typeof addressKey(':::')).toBe('string');
  });
});
