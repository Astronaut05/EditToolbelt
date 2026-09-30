import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  serverEnv: () => ({ BETTER_AUTH_SECRET: 'x'.repeat(40), SITE_URL: 'http://localhost:3000' }),
}));
vi.mock('./account', () => ({ currentUser: () => null }));

let admin: typeof import('./admin');

beforeAll(async () => {
  admin = await import('./admin');
});

describe('admin step-up cookie', () => {
  it('is valid for its user until it expires', () => {
    const value = admin.stepUpValue('user-1', 2_000);
    expect(admin.stepUpValid(value, 'user-1', 1_000)).toBe(true);
    expect(admin.stepUpValid(value, 'user-2', 1_000)).toBe(false);
    expect(admin.stepUpValid(value, 'user-1', 3_000)).toBe(false);
  });

  it('refuses a forged or edited value', () => {
    const value = admin.stepUpValue('user-1', 2_000);
    const [id, , mac] = value.split('.');
    expect(admin.stepUpValid(`${id ?? ''}.9999999999999.${mac ?? ''}`, 'user-1', 1_000)).toBe(
      false,
    );
    expect(admin.stepUpValid('user-1.2000.forged', 'user-1', 1_000)).toBe(false);
    expect(admin.stepUpValid(undefined, 'user-1', 1_000)).toBe(false);
  });
});
