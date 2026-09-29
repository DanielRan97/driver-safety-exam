// All /api/admin/* JSON routes. Every handler re-derives the admin from
// the session itself (via requireAdmin in index.js) — nothing here trusts
// anything from the client except validated path/query params.
import { findAdminByUsername } from '../db/admin.js';
import {
  verifyPassword, isLoginThrottled, recordLoginAttempt, createSession, destroySession, sessionCookieHeader,
} from './auth.js';
import { getQuestions } from '../questions.js';
import { findEmployeeById, resetCanDoAgain, countRequiredDrivers, countCompletedRequiredDrivers, listIncompleteRequiredDrivers } from '../db/employees.js';
import {
  getAttemptById, listAttemptsForEmployee, listAcceptedRequiredDriverAttempts, listGuestAttempts,
} from '../db/attempts.js';
import { getPassingScore, setPassingScore } from '../db/settings.js';
import { recordAuditLog } from '../db/audit.js';
import { computeCampaignStatistics } from '../stats.js';
import { buildResultPdf } from '../pdf.js';

const QUESTIONS = getQuestions();
const LANG_NAMES = { he: 'עברית', en: 'אנגלית', ar: 'ערבית', ru: 'רוסית', zh: 'סינית', pt: 'פורטוגזית' };

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
export async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase().slice(0, 50) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) {
    return json({ ok: false, error: 'missing credentials' }, 400);
  }

  if (await isLoginThrottled(env, username)) {
    return json({ ok: false, error: 'too_many_attempts', message: 'יותר מדי ניסיונות התחברות כושלים. נסה שוב בעוד כמה דקות.' }, 429);
  }

  const admin = await findAdminByUsername(env, username);
  const ok = admin && admin.is_active
    ? await verifyPassword(password, admin.password_hash, admin.password_salt)
    : false;

  await recordLoginAttempt(env, username, ok);

  if (!ok) {
    return json({ ok: false, error: 'invalid_credentials', message: 'שם משתמש או סיסמה שגויים.' }, 401);
  }

  const session = await createSession(env, admin.id);
  return json(
    { ok: true, admin: { username: admin.username, displayName: admin.display_name }, csrfToken: session.csrfToken },
    200,
    { 'Set-Cookie': sessionCookieHeader(session.token) },
  );
}

export async function handleLogout(request, env, admin) {
  if (admin) await destroySession(env, admin.sessionToken);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(null, { clear: true }) });
}

export function handleMe(admin) {
  return json({ ok: true, admin: { username: admin.username, displayName: admin.displayName }, csrfToken: admin.csrfToken });
}

// ---------------------------------------------------------------------
// Overview + statistics
// ---------------------------------------------------------------------
export async function handleOverview(env) {
  const [total, completed, accepted] = await Promise.all([
    countRequiredDrivers(env),
    countCompletedRequiredDrivers(env),
    listAcceptedRequiredDriverAttempts(env),
  ]);
  const stats = computeCampaignStatistics(accepted, QUESTIONS);
  return json({
    ok: true,
    totalRequired: total,
    completed,
    remaining: total - completed,
    completionPercent: total === 0 ? 0 : Math.round((completed / total) * 1000) / 10,
    averageScore: stats.averageScore,
    passedCount: stats.passedCount,
    failedCount: stats.failedCount,
    passPercent: stats.passPercent,
  });
}

export async function handleStatistics(env) {
  const accepted = await listAcceptedRequiredDriverAttempts(env);
  const stats = computeCampaignStatistics(accepted, QUESTIONS);
  const languageCounts = {};
  Object.entries(stats.languageCounts).forEach(([code, count]) => {
    languageCounts[LANG_NAMES[code] || code] = count;
  });
  return json({ ok: true, stats: { ...stats, languageCounts } });
}

// ---------------------------------------------------------------------
// Settings: configurable passing score (system_settings) — never
// affects already-stored attempts, only future submissions.
// ---------------------------------------------------------------------
export async function handleGetPassingScore(env) {
  const passingScore = await getPassingScore(env);
  return json({ ok: true, passingScore });
}

export async function handleSetPassingScore(request, env, admin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  // typeof check first: Number(null) === 0 and Number('') === 0 would
  // otherwise silently coerce a missing/malformed value into a valid
  // (if surprising) score of 0.
  const newScore = body?.passingScore;
  if (typeof newScore !== 'number' || !Number.isInteger(newScore) || newScore < 0 || newScore > 100) {
    return json({ ok: false, error: 'invalid_passing_score', message: 'ציון עובר חייב להיות מספר שלם בין 0 ל-100.' }, 400);
  }

  const oldScore = await getPassingScore(env);
  await setPassingScore(env, newScore, admin.id);
  await recordAuditLog(env, {
    adminUserId: admin.id,
    action: 'passing_score_changed',
    details: { oldValue: oldScore, newValue: newScore },
  });

  return json({ ok: true, passingScore: newScore });
}

// ---------------------------------------------------------------------
// Drivers table + incomplete list
// ---------------------------------------------------------------------
function driverStatus(attempt, canDoAgain) {
  if (!attempt) return 'not_done';
  return canDoAgain ? 'retry_approved' : 'completed';
}

export async function handleDrivers(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const statusFilter = url.searchParams.get('status') || '';
  const passedFilter = url.searchParams.get('passed') || '';
  const langFilter = url.searchParams.get('lang') || '';
  const sortBy = url.searchParams.get('sort') || 'employee_no';

  const [accepted, allRequired] = await Promise.all([
    listAcceptedRequiredDriverAttempts(env),
    env.DB.prepare(
      "SELECT id, first_name, last_name, employee_no, national_id, can_do_again FROM employees WHERE role='driver' AND is_required=1 AND is_active=1",
    ).all(),
  ]);
  const attemptByEmployee = new Map(accepted.map((a) => [a.employee_id, a]));

  let rows = allRequired.results.map((emp) => {
    const attempt = attemptByEmployee.get(emp.id) || null;
    return {
      employeeId: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      employeeNo: emp.employee_no,
      nationalId: emp.national_id,
      status: driverStatus(attempt, emp.can_do_again),
      score: attempt ? attempt.score : null,
      passed: attempt ? !!attempt.passed : null,
      submittedAt: attempt ? attempt.submitted_at : null,
      lang: attempt ? attempt.lang : null,
      attemptId: attempt ? attempt.id : null,
      pdfStatus: attempt ? attempt.pdf_status : null,
    };
  });

  if (q) {
    rows = rows.filter((r) =>
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(q)
      || (r.employeeNo || '').includes(q)
      || (r.nationalId || '').includes(q));
  }
  if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
  if (passedFilter) rows = rows.filter((r) => (passedFilter === 'passed' ? r.passed === true : r.passed === false));
  if (langFilter) rows = rows.filter((r) => r.lang === langFilter);

  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    date: (a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0),
    name: (a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`),
    status: (a, b) => a.status.localeCompare(b.status),
    employee_no: (a, b) => String(a.employeeNo).localeCompare(String(b.employeeNo), undefined, { numeric: true }),
  };
  rows.sort(sorters[sortBy] || sorters.employee_no);

  return json({ ok: true, drivers: rows });
}

export async function handleIncomplete(env) {
  const rows = await listIncompleteRequiredDrivers(env);
  return json({
    ok: true,
    count: rows.length,
    drivers: rows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, employeeNo: r.employee_no })),
  });
}

export async function handleGuests(env) {
  const rows = await listGuestAttempts(env);
  return json({ ok: true, attempts: rows.map(summarizeAttempt) });
}

function summarizeAttempt(a) {
  return {
    attemptId: a.id,
    firstName: a.first_name,
    lastName: a.last_name,
    employeeNo: a.employee_no,
    nationalId: a.national_id,
    score: a.score,
    passed: !!a.passed,
    submittedAt: a.submitted_at,
    lang: a.lang,
    pdfStatus: a.pdf_status,
    isGuest: !!a.is_guest,
  };
}

// ---------------------------------------------------------------------
// Driver detail — every question/answer mapped back to canonical Hebrew,
// regardless of which language the exam itself was taken in.
// ---------------------------------------------------------------------
export async function handleDriverDetail(env, employeeId) {
  const employee = await findEmployeeById(env, employeeId);
  if (!employee) return json({ ok: false, error: 'not_found' }, 404);

  const attempts = await listAttemptsForEmployee(env, employeeId);
  const latest = attempts[0] || null;

  return json({
    ok: true,
    employee: {
      firstName: employee.first_name,
      lastName: employee.last_name,
      employeeNo: employee.employee_no,
      nationalId: employee.national_id,
      canDoAgain: !!employee.can_do_again,
    },
    latestAttempt: latest ? buildAttemptDetail(latest) : null,
    attemptHistory: attempts.map((a) => ({
      attemptId: a.id,
      score: a.score,
      passed: !!a.passed,
      submittedAt: a.submitted_at,
      lang: a.lang,
      pdfStatus: a.pdf_status,
    })),
  });
}

export async function handleAttemptDetail(env, attemptId) {
  const attempt = await getAttemptById(env, attemptId);
  if (!attempt) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, attempt: buildAttemptDetail(attempt) });
}

function buildAttemptDetail(attempt) {
  // The Hebrew question bank snapshotted at submission time — this is
  // what guarantees the admin view stays in Hebrew and understandable
  // even if the driver took the exam in another language, and even if
  // the live question bank changes later.
  let snapshot;
  try {
    snapshot = JSON.parse(attempt.questions_snapshot || '[]');
  } catch {
    snapshot = [];
  }
  const questionsByIndex = snapshot.length ? snapshot : QUESTIONS.map((q, i) => ({ index: i, q: q.q, opts: q.opts, correct: q.correct }));

  let answers;
  try {
    answers = JSON.parse(attempt.answers_json || '[]');
  } catch {
    answers = [];
  }

  const letters = ['א', 'ב', 'ג', 'ד'];
  const questions = answers.map((a) => {
    const q = questionsByIndex[a.questionIndex] || QUESTIONS[a.questionIndex];
    return {
      index: a.questionIndex,
      questionText: q ? q.q : '',
      chosenText: q && q.opts[a.chosen] != null ? `${letters[a.chosen]}. ${q.opts[a.chosen]}` : null,
      correctText: q && q.opts[a.correct] != null ? `${letters[a.correct]}. ${q.opts[a.correct]}` : null,
      isCorrect: !!a.isCorrect,
    };
  });

  return {
    attemptId: attempt.id,
    firstName: attempt.first_name,
    lastName: attempt.last_name,
    employeeNo: attempt.employee_no,
    nationalId: attempt.national_id,
    email: attempt.email,
    isGuest: !!attempt.is_guest,
    lang: attempt.lang,
    langName: LANG_NAMES[attempt.lang] || attempt.lang,
    score: attempt.score,
    passed: !!attempt.passed,
    correctCount: attempt.correct_count,
    incorrectCount: questions.length - attempt.correct_count,
    submittedAt: attempt.submitted_at,
    pdfStatus: attempt.pdf_status,
    questions,
  };
}

// ---------------------------------------------------------------------
// Actions (CSRF-protected — enforced by the caller in index.js)
// ---------------------------------------------------------------------
export async function handleCanDoAgain(env, employeeId) {
  const employee = await findEmployeeById(env, employeeId);
  if (!employee) return json({ ok: false, error: 'not_found' }, 404);
  await env.DB.prepare('UPDATE employees SET can_do_again = 1 WHERE id = ?').bind(employeeId).run();
  return json({ ok: true });
}

export function buildAttemptPdfData(attempt) {
  const submission = {
    first: attempt.first_name,
    last: attempt.last_name,
    email: attempt.email,
    id: attempt.national_id,
    empnum: attempt.employee_no,
    date: attempt.date_field,
    lang: attempt.lang,
    answers: JSON.parse(attempt.answers_json).map((a) => a.chosen),
    correct: attempt.correct_count,
    score: attempt.score,
    // The threshold actually in effect at submission time — regenerating
    // a PDF later must never show a different passing score than the
    // driver originally saw, even if system_settings has since changed.
    passingScore: attempt.passing_score_at_submission,
    passed: !!attempt.passed,
  };
  // Keep the wording and threshold from the original submission.
  const savedQuestions = JSON.parse(attempt.questions_snapshot || 'null');
  const questions = Array.isArray(savedQuestions) && savedQuestions.length ? savedQuestions : QUESTIONS;
  return { submission, questions };
}

export async function handleRetryPdf(env, attemptId) {
  const attempt = await getAttemptById(env, attemptId);
  if (!attempt) return json({ ok: false, error: 'not_found' }, 404);

  try {
    const pdfBuffer = await buildResultPdf(env, buildAttemptPdfData(attempt));
    const r2Key = `exam-pdfs/${attempt.id}.pdf`;
    await env.PDF_BUCKET.put(r2Key, pdfBuffer, { httpMetadata: { contentType: 'application/pdf' } });
    await env.DB.prepare(
      "UPDATE exam_attempts SET pdf_status='stored', pdf_r2_key=?, pdf_created_at=CURRENT_TIMESTAMP, pdf_error=NULL WHERE id=?",
    )
      .bind(r2Key, attempt.id)
      .run();
    return json({ ok: true });
  } catch (err) {
    await env.DB.prepare("UPDATE exam_attempts SET pdf_status='failed', pdf_error=? WHERE id=?")
      .bind(String(err && err.message).slice(0, 500), attempt.id)
      .run();
    return json({ ok: false, error: 'pdf_generation_failed' }, 500);
  }
}

export async function handleAttemptPdf(env, attemptId) {
  const attempt = await getAttemptById(env, attemptId);
  if (!attempt || attempt.pdf_status !== 'stored' || !attempt.pdf_r2_key) {
    return json({ ok: false, error: 'pdf_not_available' }, 404);
  }
  const object = await env.PDF_BUCKET.get(attempt.pdf_r2_key);
  if (!object) return json({ ok: false, error: 'pdf_not_available' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="driver-safety-exam-${attempt.employee_no || attempt.id}.pdf"`,
    },
  });
}
