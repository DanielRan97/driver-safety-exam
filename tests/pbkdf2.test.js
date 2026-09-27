import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../worker/admin/auth.js';
import { PBKDF2_ITERATIONS } from '../worker/admin/constants.mjs';

// Regression test for a production incident: auth.js and create-admin.js
// each hardcoded their own PBKDF2_ITERATIONS (150000), which the Workers
// runtime's Web Crypto PBKDF2 implementation silently rejects above
// 100000 (NotSupportedError) — a limit the local test runtime's
// workerd build does not enforce, so this never failed in `npm test`
// until it broke admin login in production. Both files now import the
// same constant; this test guards the value itself so it can't drift
// back above the runtime's hard ceiling without a red test.
describe('PBKDF2 configuration', () => {
  it('never configures more than the Workers runtime\'s 100000-iteration ceiling', () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100000);
    expect(PBKDF2_ITERATIONS).toBeGreaterThan(0);
  });

  it('hashes and verifies a password end-to-end via the Cloudflare-compatible (Web Crypto) implementation', async () => {
    const { hash, salt, iterations } = await hashPassword('correct horse battery staple');
    expect(iterations).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
    expect(await verifyPassword('wrong password', hash, salt)).toBe(false);
  });
});
