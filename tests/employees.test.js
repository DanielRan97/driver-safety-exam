import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  findEmployeeByNationalId, resetCanDoAgain, countRequiredDrivers, countCompletedRequiredDrivers,
} from '../worker/db/employees.js';
import { createCompletedAttempt } from '../worker/db/attempts.js';

// Fresh, disposable test employees — never reuse a seeded real driver, so
// tests never consume a real person's one-time attempt.
async function insertTestEmployee(overrides = {}) {
  const nationalId = overrides.nationalId || `9${Math.floor(Math.random() * 1e8)}`.padStart(9, '0');
  await env.DB.prepare(
    `INSERT INTO employees (first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      overrides.firstName ?? 'Test',
      overrides.lastName ?? 'Driver',
      overrides.employeeNo ?? '9001',
      nationalId,
      overrides.role ?? 'driver',
      overrides.isRequired ?? 1,
      overrides.canDoAgain ?? 0,
      overrides.isActive ?? 1,
    )
    .run();
  return findEmployeeByNationalId(env, nationalId);
}

async function sendAttempt(employee, { token } = {}) {
  const submissionToken = token || crypto.randomUUID();
  return createCompletedAttempt(env, {
    employeeId: employee.id,
    isGuest: false,
    firstName: employee.first_name,
    lastName: employee.last_name,
    employeeNo: employee.employee_no,
    nationalId: employee.national_id,
    submissionToken,
    email: 'test@example.com',
    dateField: '2026-09-27',
    lang: 'he',
    score: 100,
    correctCount: 20,
    passed: true,
    submittedAt: new Date().toISOString(),
    questionsSnapshot: '[]',
    answersJson: '[]',
    statisticsJson: '{}',
  });
}

describe('employee lookup', () => {
  // 1. Required driver with valid ID
  it('finds a required driver by exact national ID', async () => {
    const emp = await insertTestEmployee();
    const found = await findEmployeeByNationalId(env, emp.national_id);
    expect(found).not.toBeNull();
    expect(found.first_name).toBe('Test');
  });

  // 2. Unknown ID -> guest flow (via the real HTTP endpoint)
  it('POST /api/employee/verify returns status "guest" for an unknown ID', async () => {
    const res = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: '000000000000' }),
    });
    const body = await res.json();
    expect(body.status).toBe('guest');
  });

  // 3. Inactive employee -> treated as not found (guest path), not a match
  it('treats an inactive employee as unfindable for the exam flow', async () => {
    const emp = await insertTestEmployee({ isActive: 0 });
    const res = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: emp.national_id }),
    });
    const body = await res.json();
    expect(body.status).toBe('guest');
  });

  // 4. ID beginning with zero survives the full HTTP round trip intact
  it('correctly verifies an employee whose national ID starts with 0', async () => {
    const emp = await insertTestEmployee({ nationalId: '098765432' });
    expect(emp.national_id).toBe('098765432');
    const res = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: '098765432' }),
    });
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.employee.firstName).toBe('Test');
  });

  // 6. Same driver attempts second exam -> blocked
  it('blocks verify for a required driver who already has a sent attempt', async () => {
    const emp = await insertTestEmployee();
    await sendAttempt(emp);
    const res = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: emp.national_id }),
    });
    const body = await res.json();
    expect(body.status).toBe('blocked');
  });

  // 7. Manually set can_do_again=true -> allowed again
  it('allows a re-verify once can_do_again is set, even after a sent attempt', async () => {
    const emp = await insertTestEmployee();
    await sendAttempt(emp);
    await env.DB.prepare('UPDATE employees SET can_do_again = 1 WHERE id = ?').bind(emp.id).run();

    const res = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: emp.national_id }),
    });
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  // 8. can_do_again resets after a successful retry
  it('resetCanDoAgain clears the one-time override', async () => {
    const emp = await insertTestEmployee({ canDoAgain: 1 });
    await resetCanDoAgain(env, emp.id);
    const refreshed = await findEmployeeByNationalId(env, emp.national_id);
    expect(refreshed.can_do_again).toBe(0);
  });

  // 13 / 19. A required driver with two allowed sent attempts still counts once
  it('counts a required driver exactly once even with two sent attempts (can_do_again)', async () => {
    const emp = await insertTestEmployee();
    const before = await countCompletedRequiredDrivers(env);

    await sendAttempt(emp);
    const afterFirst = await countCompletedRequiredDrivers(env);
    expect(afterFirst).toBe(before + 1);

    await sendAttempt(emp); // simulate an allowed second attempt
    const afterSecond = await countCompletedRequiredDrivers(env);
    expect(afterSecond).toBe(before + 1); // still +1, not +2
  });

  // 18. Progress calculation (delta-based, so it's independent of other
  // tests' shared seed/state)
  it('total required driver count only includes active, required rows', async () => {
    const totalBefore = await countRequiredDrivers(env);
    await insertTestEmployee(); // +1 required
    await insertTestEmployee({ isRequired: 0 }); // not required -> should not count
    await insertTestEmployee({ isActive: 0 }); // inactive -> should not count
    const totalAfter = await countRequiredDrivers(env);
    expect(totalAfter).toBe(totalBefore + 1);
  });
});

// 12 / 13 / 14. There is no tester role anymore — Daniel Ran and Efi Caro
// (also admins via the separate admin_users table) are plain required
// drivers in `employees` and follow the exact same one-attempt-plus-
// can_do_again rule as everyone else. No admin special-casing.
describe('Daniel Ran and Efi Caro are normal required drivers', () => {
  const DANIEL_NATIONAL_ID = '318188505';
  const EFI_NATIONAL_ID = '318316171';

  it('both are role=driver, is_required=1 — not tester', async () => {
    const daniel = await findEmployeeByNationalId(env, DANIEL_NATIONAL_ID);
    const efi = await findEmployeeByNationalId(env, EFI_NATIONAL_ID);
    expect(daniel.role).toBe('driver');
    expect(daniel.is_required).toBe(1);
    expect(efi.role).toBe('driver');
    expect(efi.is_required).toBe(1);
  });

  it('Daniel is blocked after one completed attempt, exactly like any required driver', async () => {
    const daniel = await findEmployeeByNationalId(env, DANIEL_NATIONAL_ID);
    await sendAttempt(daniel);
    const res = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: DANIEL_NATIONAL_ID }),
    });
    expect((await res.json()).status).toBe('blocked');
  });

  it('Efi\'s admin privileges grant no exam exemption — can_do_again works the same as any driver', async () => {
    const efi = await findEmployeeByNationalId(env, EFI_NATIONAL_ID);
    await sendAttempt(efi);
    await env.DB.prepare('UPDATE employees SET can_do_again = 1 WHERE id = ?').bind(efi.id).run();

    const allowed = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: EFI_NATIONAL_ID }),
    });
    expect((await allowed.json()).status).toBe('ok');

    await resetCanDoAgain(env, efi.id); // the retry flow would consume it, same as any driver
    const refreshed = await findEmployeeByNationalId(env, EFI_NATIONAL_ID);
    expect(refreshed.can_do_again).toBe(0);

    const blockedAgain = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: EFI_NATIONAL_ID }),
    });
    expect((await blockedAgain.json()).status).toBe('blocked');
  });
});
