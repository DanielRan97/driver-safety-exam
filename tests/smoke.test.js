import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('smoke test — D1 + migrations', () => {
  // 0005_add_required_drivers.sql converts the original 2 testers
  // (Daniel Ran, Efi Caro) to required drivers and adds 5 more people,
  // so the original 48-driver/2-tester seed is now 55 drivers/0 testers.
  it('has seeded 55 required drivers and 0 testers', async () => {
    const drivers = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM employees WHERE role='driver' AND is_required=1",
    ).first();
    const testers = await env.DB.prepare("SELECT COUNT(*) AS n FROM employees WHERE role='tester'").first();
    expect(drivers.n).toBe(55);
    expect(testers.n).toBe(0);
  });

  it('preserves a leading-zero national ID as text', async () => {
    const row = await env.DB.prepare('SELECT national_id FROM employees WHERE first_name = ?')
      .bind('David')
      .first();
    expect(row.national_id).toBe('052562568');
  });
});
