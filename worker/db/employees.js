// Employee lookups. national_id is always handled as a string — never
// parsed/compared as a number (Israeli IDs can start with "0").

export async function findEmployeeByNationalId(env, nationalId) {
  const row = await env.DB.prepare(
    'SELECT id, first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active FROM employees WHERE national_id = ?',
  )
    .bind(nationalId)
    .first();
  return row || null;
}

export async function findEmployeeById(env, employeeId) {
  const row = await env.DB.prepare(
    'SELECT id, first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active FROM employees WHERE id = ?',
  )
    .bind(employeeId)
    .first();
  return row || null;
}

// Resets the one-time can_do_again override after it has been used for a
// successful (email_status='sent') retry, so it doesn't grant unlimited
// retakes.
export async function resetCanDoAgain(env, employeeId) {
  await env.DB.prepare('UPDATE employees SET can_do_again = 0 WHERE id = ?').bind(employeeId).run();
}

export async function countRequiredDrivers(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM employees WHERE role = 'driver' AND is_required = 1 AND is_active = 1",
  ).first();
  return row ? row.n : 0;
}

// Distinct employees, not attempt rows — a driver with two allowed (e.g.
// can_do_again) sent attempts still counts once.
export async function countCompletedRequiredDrivers(env) {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT a.employee_id) AS n
     FROM exam_attempts a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.is_guest = 0 AND a.email_status = 'sent'
       AND e.role = 'driver' AND e.is_required = 1`,
  ).first();
  return row ? row.n : 0;
}

export async function listRequiredDrivers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, first_name, last_name, employee_no, national_id FROM employees WHERE role = 'driver' AND is_required = 1 AND is_active = 1 ORDER BY employee_no",
  ).all();
  return results || [];
}
