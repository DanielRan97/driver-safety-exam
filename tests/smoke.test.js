import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('smoke test — D1 + migrations', () => {
  it('has seeded 48 required drivers and 2 testers', async () => {
    const drivers = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM employees WHERE role='driver' AND is_required=1",
    ).first();
    const testers = await env.DB.prepare("SELECT COUNT(*) AS n FROM employees WHERE role='tester'").first();
    expect(drivers.n).toBe(48);
    expect(testers.n).toBe(2);
  });

  it('preserves a leading-zero national ID as text', async () => {
    const row = await env.DB.prepare('SELECT national_id FROM employees WHERE first_name = ?')
      .bind('David')
      .first();
    expect(row.national_id).toBe('052562568');
  });
});
