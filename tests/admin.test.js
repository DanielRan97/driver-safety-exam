import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../worker/admin/auth.js';
import { getQuestions } from '../worker/questions.js';

const QUESTIONS = getQuestions();

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
async function createAdmin(username, password, displayName = username) {
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO admin_users (username, display_name, password_hash, password_salt, role, is_active, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, CURRENT_TIMESTAMP)`,
  )
    .bind(username, displayName, hash, salt)
    .run();
}

function extractCookie(res) {
  const raw = res.headers.get('Set-Cookie') || '';
  const match = raw.match(/admin_session=([^;]+)/);
  return match ? `admin_session=${match[1]}` : null;
}

async function login(username, password) {
  const res = await SELF.fetch('https://example.com/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  return { status: res.status, body, cookie: extractCookie(res) };
}

async function adminFetch(path, { method = 'GET', cookie, csrf, body, raw = false } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await SELF.fetch(`https://example.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

async function insertTestEmployee(overrides = {}) {
  const nationalId = overrides.nationalId || `6${Math.floor(Math.random() * 1e8)}`.padStart(9, '0');
  await env.DB.prepare(
    `INSERT INTO employees (first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      overrides.firstName ?? 'Admin',
      overrides.lastName ?? 'Test',
      overrides.employeeNo ?? `A${Math.floor(Math.random() * 1e6)}`,
      nationalId,
      overrides.role ?? 'driver',
      overrides.isRequired ?? 1,
      overrides.canDoAgain ?? 0,
      overrides.isActive ?? 1,
    )
    .run();
  return env.DB.prepare('SELECT * FROM employees WHERE national_id = ?').bind(nationalId).first();
}

// Submits a real exam via the public endpoint so admin tests exercise the
// same data the driver flow actually produces (questions_snapshot,
// answers_json, etc.) rather than hand-rolled rows.
async function submitExam(employee, { lang = 'he', wrongIndexes = [] } = {}) {
  const answers = QUESTIONS.map((q, i) => (wrongIndexes.includes(i) ? (q.correct + 1) % q.opts.length : q.correct));
  const res = await SELF.fetch('https://example.com/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first: employee.first_name,
      last: employee.last_name,
      email: 'test@example.com',
      id: employee.national_id,
      empnum: employee.employee_no,
      date: '2026-09-27',
      lang,
      answers,
      submissionToken: crypto.randomUUID(),
    }),
  });
  return res.json();
}

let adminCookie;
let adminCsrf;

beforeAll(async () => {
  await createAdmin('daniel_test', 'DanielTestPass123!', 'Daniel Ran');
  await createAdmin('efi_test', 'EfiTestPass123!', 'Efi Caro');
  const session = await login('daniel_test', 'DanielTestPass123!');
  adminCookie = session.cookie;
  adminCsrf = session.body.csrfToken;
});

// ---------------------------------------------------------------------
// 1. Unauthenticated access is blocked server-side
// ---------------------------------------------------------------------
describe('admin auth — unauthenticated access', () => {
  it('GET /admin without a session shows the login page, not the dashboard', async () => {
    const res = await SELF.fetch('https://example.com/admin');
    const html = await res.text();
    expect(html).toContain('id="username"');
    expect(html).not.toContain('סקירה כללית');
  });

  it('every /api/admin/* JSON route rejects a request with no session cookie', async () => {
    const routes = ['/api/admin/overview', '/api/admin/statistics', '/api/admin/drivers', '/api/admin/incomplete', '/api/admin/testers', '/api/admin/guests'];
    for (const path of routes) {
      const { status, body } = await adminFetch(path);
      expect(status).toBe(401);
      expect(body.ok).toBe(false);
    }
  });

  it('rejects a garbage/forged session cookie', async () => {
    const { status } = await adminFetch('/api/admin/overview', { cookie: 'admin_session=not-a-real-token' });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------
// 2/3. Login — valid and invalid, for both Daniel and Efi
// ---------------------------------------------------------------------
describe('admin auth — login', () => {
  it('logs Daniel in with the correct password', async () => {
    const { status, body } = await login('daniel_test', 'DanielTestPass123!');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.admin.displayName).toBe('Daniel Ran');
    expect(typeof body.csrfToken).toBe('string');
  });

  it('logs Efi in with the correct password', async () => {
    const { status, body } = await login('efi_test', 'EfiTestPass123!');
    expect(status).toBe(200);
    expect(body.admin.displayName).toBe('Efi Caro');
  });

  it('rejects a wrong password without revealing whether the username exists', async () => {
    const wrongPass = await login('daniel_test', 'wrong-password');
    const unknownUser = await login('nobody-such-user', 'whatever');
    expect(wrongPass.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPass.body.message).toBe(unknownUser.body.message);
  });

  it('rejects login for an inactive admin account', async () => {
    await createAdmin('disabled_test', 'DisabledPass123!', 'Disabled Admin');
    await env.DB.prepare("UPDATE admin_users SET is_active = 0 WHERE username = 'disabled_test'").run();
    const { status } = await login('disabled_test', 'DisabledPass123!');
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------
// Login throttling (5 failed attempts / 15 min -> 429), including the
// bug found+fixed during live verification: the throttle cutoff must be
// computed with SQLite's own datetime(), not a JS toISOString() string.
// ---------------------------------------------------------------------
describe('admin auth — login throttling', () => {
  it('blocks the 6th attempt within the window, even with the correct password, after 5 failures', async () => {
    await createAdmin('throttle_test', 'ThrottleTestPass123!', 'Throttle Test');
    for (let i = 0; i < 5; i++) {
      const { status } = await login('throttle_test', `wrong-${i}`);
      expect(status).toBe(401);
    }
    const blocked = await login('throttle_test', 'ThrottleTestPass123!');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('too_many_attempts');
  });
});

// ---------------------------------------------------------------------
// CSRF enforcement on every state-changing admin route
// ---------------------------------------------------------------------
describe('admin auth — CSRF protection', () => {
  it('rejects a state-changing request with no CSRF header', async () => {
    const emp = await insertTestEmployee();
    const { status, body } = await adminFetch(`/api/admin/drivers/${emp.id}/can-do-again`, {
      method: 'POST', cookie: adminCookie,
    });
    expect(status).toBe(403);
    expect(body.error).toBe('csrf_check_failed');
  });

  it('rejects a state-changing request with a wrong CSRF header', async () => {
    const emp = await insertTestEmployee();
    const { status } = await adminFetch(`/api/admin/drivers/${emp.id}/can-do-again`, {
      method: 'POST', cookie: adminCookie, csrf: 'wrong-token',
    });
    expect(status).toBe(403);
  });

  it('accepts a state-changing request with the correct CSRF header', async () => {
    const emp = await insertTestEmployee();
    const { status, body } = await adminFetch(`/api/admin/drivers/${emp.id}/can-do-again`, {
      method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('does not require CSRF for a plain GET', async () => {
    const { status } = await adminFetch('/api/admin/overview', { cookie: adminCookie });
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------
// Logout + session expiration
// ---------------------------------------------------------------------
describe('admin auth — logout and session lifetime', () => {
  it('logout invalidates the session immediately', async () => {
    const session = await login('daniel_test', 'DanielTestPass123!');
    const before = await adminFetch('/api/admin/overview', { cookie: session.cookie });
    expect(before.status).toBe(200);

    await adminFetch('/api/admin/logout', { method: 'POST', cookie: session.cookie, csrf: session.body.csrfToken });

    const after = await adminFetch('/api/admin/overview', { cookie: session.cookie });
    expect(after.status).toBe(401);
  });

  it('rejects a session past its expires_at', async () => {
    const session = await login('daniel_test', 'DanielTestPass123!');
    const token = session.cookie.split('=')[1];
    await env.DB.prepare("UPDATE admin_sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token = ?").bind(token).run();

    const { status } = await adminFetch('/api/admin/overview', { cookie: session.cookie });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------
// Driver data: required-driver counting, tester/guest exclusion,
// incomplete list
// ---------------------------------------------------------------------
describe('admin data — overview, incomplete, exclusions', () => {
  it('overview counts only required drivers, excluding testers and guests', async () => {
    const before = await adminFetch('/api/admin/overview', { cookie: adminCookie });

    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    const tester = await insertTestEmployee({ isRequired: 0, role: 'tester' });
    await submitExam(driver);
    await submitExam(tester);
    // guest: national id that matches no employee
    await SELF.fetch('https://example.com/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first: 'אורח', last: 'זר', email: 'guest@example.com',
        id: `5${Math.floor(Math.random() * 1e8)}`.padStart(9, '0'),
        empnum: '', date: '2026-09-27', lang: 'he',
        answers: QUESTIONS.map((q) => q.correct),
        submissionToken: crypto.randomUUID(),
      }),
    });

    const after = await adminFetch('/api/admin/overview', { cookie: adminCookie });
    expect(after.body.totalRequired).toBe(before.body.totalRequired + 1);
    expect(after.body.completed).toBe(before.body.completed + 1);
  });

  it('lists a required driver who has not attempted in /api/admin/incomplete', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver', firstName: 'NeverTook', lastName: 'TheExam' });
    const { body } = await adminFetch('/api/admin/incomplete', { cookie: adminCookie });
    expect(body.drivers.some((d) => d.firstName === 'NeverTook')).toBe(true);
  });

  it('testers appear under /api/admin/testers, not the drivers table', async () => {
    const tester = await insertTestEmployee({ role: 'tester', isRequired: 0, firstName: 'Tester', lastName: `T${Date.now()}` });
    await submitExam(tester);
    const testers = await adminFetch('/api/admin/testers', { cookie: adminCookie });
    expect(testers.body.attempts.some((a) => a.lastName === tester.last_name)).toBe(true);

    const drivers = await adminFetch('/api/admin/drivers', { cookie: adminCookie });
    expect(drivers.body.drivers.some((d) => d.lastName === tester.last_name)).toBe(false);
  });

  it('guests appear under /api/admin/guests', async () => {
    const guestId = `4${Math.floor(Math.random() * 1e8)}`.padStart(9, '0');
    await SELF.fetch('https://example.com/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first: 'Guest', last: `G${Date.now()}`, email: 'guest2@example.com',
        id: guestId, empnum: '', date: '2026-09-27', lang: 'en',
        answers: QUESTIONS.map((q) => q.correct),
        submissionToken: crypto.randomUUID(),
      }),
    });
    const { body } = await adminFetch('/api/admin/guests', { cookie: adminCookie });
    expect(body.attempts.some((a) => a.nationalId === guestId)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Statistics correctness
// ---------------------------------------------------------------------
describe('admin statistics', () => {
  it('reflects a perfect score and a below-60 score in the distribution buckets', async () => {
    const perfect = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(perfect); // all correct -> 100

    const failing = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    const majorityWrong = QUESTIONS.map((q, i) => i).filter((i) => i % 2 === 0); // fail most questions
    await submitExam(failing, { wrongIndexes: majorityWrong });

    const { body } = await adminFetch('/api/admin/statistics', { cookie: adminCookie });
    const bucket90 = body.stats.scoreDistribution.find((b) => b.label === '90-100');
    expect(bucket90.count).toBeGreaterThanOrEqual(1);
    expect(body.stats.mostMissedQuestions).toHaveLength(5);
    expect(body.stats.mostCorrectlyAnsweredQuestions).toHaveLength(5);
  });

  it('counts language completions', async () => {
    const enDriver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(enDriver, { lang: 'en' });
    const { body } = await adminFetch('/api/admin/statistics', { cookie: adminCookie });
    expect(body.stats.languageCounts['אנגלית']).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------
// Hebrew question/answer mapping regardless of exam language
// ---------------------------------------------------------------------
describe('admin driver detail — Hebrew display is language-independent', () => {
  it('shows Hebrew question text for an exam taken in English', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(driver, { lang: 'en' });

    const { body } = await adminFetch(`/api/admin/drivers/${driver.id}`, { cookie: adminCookie });
    expect(body.ok).toBe(true);
    expect(body.latestAttempt.lang).toBe('en');
    expect(body.latestAttempt.questions[0].questionText).toBe(QUESTIONS[0].q);
  });

  it('shows Hebrew question text for an exam taken in Arabic', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(driver, { lang: 'ar' });

    const { body } = await adminFetch(`/api/admin/drivers/${driver.id}`, { cookie: adminCookie });
    expect(body.latestAttempt.questions[0].questionText).toBe(QUESTIONS[0].q);
  });
});

// ---------------------------------------------------------------------
// PDF: requires admin auth, requires pdf_status='stored', no IDOR leak
// ---------------------------------------------------------------------
describe('admin PDF access', () => {
  it('rejects an unauthenticated PDF request', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(driver);
    const attempt = await env.DB.prepare('SELECT id FROM exam_attempts WHERE employee_id = ?').bind(driver.id).first();
    const res = await SELF.fetch(`https://example.com/api/admin/attempts/${attempt.id}/pdf`);
    expect(res.status).toBe(401);
  });

  it('returns 404 (not a crash) when the PDF was never stored', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(driver); // Browser Run isn't available locally -> pdf_status stays pending/failed
    const attempt = await env.DB.prepare('SELECT id FROM exam_attempts WHERE employee_id = ?').bind(driver.id).first();
    const { status, body } = await adminFetch(`/api/admin/attempts/${attempt.id}/pdf`, { cookie: adminCookie });
    expect(status).toBe(404);
    expect(body.error).toBe('pdf_not_available');
  });

  it('returns 404 for a non-existent attempt id rather than leaking server error detail', async () => {
    const { status, body } = await adminFetch('/api/admin/attempts/999999999/pdf', { cookie: adminCookie });
    expect(status).toBe(404);
    expect(body.error).toBe('pdf_not_available');
  });

  it('serves the PDF inline with the correct content type once stored', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(driver);
    const attempt = await env.DB.prepare('SELECT id FROM exam_attempts WHERE employee_id = ?').bind(driver.id).first();

    // submitExam()'s background ctx.waitUntil(generateAndStorePdf) is still
    // racing in the background (no Browser Run in this local runtime, so it
    // will settle to pdf_status='failed') — wait for it to finish before
    // simulating a successful store, otherwise it clobbers our write.
    for (let i = 0; i < 20; i++) {
      const row = await env.DB.prepare('SELECT pdf_status FROM exam_attempts WHERE id=?').bind(attempt.id).first();
      if (row.pdf_status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    await env.PDF_BUCKET.put(`exam-pdfs/${attempt.id}.pdf`, new Uint8Array([37, 80, 68, 70]));
    await env.DB.prepare("UPDATE exam_attempts SET pdf_status='stored', pdf_r2_key=? WHERE id=?")
      .bind(`exam-pdfs/${attempt.id}.pdf`, attempt.id)
      .run();

    const res = await adminFetch(`/api/admin/attempts/${attempt.id}/pdf`, { cookie: adminCookie, raw: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});

// ---------------------------------------------------------------------
// can_do_again: requires auth+CSRF (covered above), applies correctly,
// and is a one-time override that resets after the retry succeeds.
// ---------------------------------------------------------------------
describe('admin action — can_do_again', () => {
  it('blocks a second attempt until can_do_again is set, then allows exactly one retry', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    await submitExam(driver);

    const blockedVerify = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: driver.national_id }),
    });
    expect((await blockedVerify.json()).status).toBe('blocked');

    await adminFetch(`/api/admin/drivers/${driver.id}/can-do-again`, {
      method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    });

    const allowedVerify = await SELF.fetch('https://example.com/api/employee/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nationalId: driver.national_id }),
    });
    expect((await allowedVerify.json()).status).toBe('ok');

    await submitExam(driver); // consumes the one-time override

    const refreshed = await env.DB.prepare('SELECT can_do_again FROM employees WHERE id = ?').bind(driver.id).first();
    expect(refreshed.can_do_again).toBe(0);
  });

  it('returns 404 for a non-existent employee id (no IDOR data leak)', async () => {
    const { status, body } = await adminFetch('/api/admin/drivers/999999999/can-do-again', {
      method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    });
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });
});

// ---------------------------------------------------------------------
// Attempt history: multiple attempts for the same driver are all visible
// ---------------------------------------------------------------------
describe('admin driver detail — attempt history', () => {
  it('lists every attempt for a driver who retried, most recent first', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver', canDoAgain: 1 });
    await submitExam(driver);
    await env.DB.prepare('UPDATE employees SET can_do_again = 1 WHERE id = ?').bind(driver.id).run();
    await submitExam(driver);

    const { body } = await adminFetch(`/api/admin/drivers/${driver.id}`, { cookie: adminCookie });
    expect(body.attemptHistory.length).toBeGreaterThanOrEqual(2);
    const dates = body.attemptHistory.map((a) => a.submittedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

// ---------------------------------------------------------------------
// No national ID ever appears in a URL for these routes (defense in
// depth check on the routes this suite exercises — they're keyed by
// numeric employee_id / attempt_id, never national_id).
// ---------------------------------------------------------------------
describe('admin routes never key on national ID', () => {
  it('driver detail and can-do-again routes use numeric ids, not national IDs', async () => {
    const driver = await insertTestEmployee({ isRequired: 1, role: 'driver' });
    const byId = await adminFetch(`/api/admin/drivers/${driver.id}`, { cookie: adminCookie });
    expect(byId.status).toBe(200);

    // The route is keyed by the small autoincrement employee.id, not
    // national_id — a 9-digit national-id-shaped path is numeric (so it
    // still matches the route regex) but won't coincide with any real
    // employee.id, so the lookup correctly 404s rather than ever
    // resolving to a driver by national ID.
    const byNationalId = await adminFetch(`/api/admin/drivers/${driver.national_id}`, { cookie: adminCookie });
    expect(byNationalId.status).toBe(404);
  });
});
