// Cloudflare Worker entry point. Static files (public/index.html,
// public/assets/*) are served directly by the Workers "assets" binding
// before requests ever reach this code — this file handles:
//   POST /api/employee/verify, POST /api/submit   (public exam)
//   GET  /admin, /admin/*                          (admin HTML shell)
//   POST /api/admin/*                              (admin JSON API)
import { getQuestions } from './questions.js';
import { buildResultPdf } from './pdf.js';
import { findEmployeeByNationalId, resetCanDoAgain } from './db/employees.js';
import {
  findAttemptByToken, hasCompletedAttempt, createCompletedAttempt, markPdfStored, markPdfFailed,
} from './db/attempts.js';
import { getPassingScore } from './db/settings.js';
import { getAdminFromRequest, checkCsrf } from './admin/auth.js';
import { buildLoginPage, buildDashboardPage } from './admin/pages.js';
import {
  handleLogin, handleLogout, handleMe, handleOverview, handleStatistics, handleDrivers, handleIncomplete,
  handleGuests, handleDriverDetail, handleAttemptDetail, handleCanDoAgain, handleRetryPdf, handleAttemptPdf,
  handleGetPassingScore, handleSetPassingScore,
} from './admin/routes.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUESTIONS = getQuestions();
const ALREADY_COMPLETED_MESSAGE = 'כבר השלמת בהצלחה את מבחן הבטיחות. אם לדעתך זו טעות, פנה למנהל.';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function maskId(id) {
  const s = String(id || '');
  return s.length <= 3 ? '***' : `***${s.slice(-3)}`;
}

// ---------------------------------------------------------------------
// POST /api/employee/verify
// ---------------------------------------------------------------------
async function handleVerify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'invalid json' }, 400);
  }
  const nationalId = typeof body?.nationalId === 'string' ? body.nationalId.trim().slice(0, 50) : '';
  if (!nationalId) return json({ status: 'error', message: 'missing nationalId' }, 400);

  const employee = await findEmployeeByNationalId(env, nationalId);
  if (!employee || !employee.is_active) return json({ status: 'guest' });

  const isRequired = !!employee.is_required;

  if (isRequired) {
    const already = await hasCompletedAttempt(env, employee.id);
    if (already && !employee.can_do_again) {
      return json({ status: 'blocked', message: ALREADY_COMPLETED_MESSAGE });
    }
  }

  return json({
    status: 'ok',
    employee: { firstName: employee.first_name, lastName: employee.last_name, employeeNo: employee.employee_no },
  });
}

// ---------------------------------------------------------------------
// Background: generate the PDF and store it in R2. Runs via
// ctx.waitUntil() *after* the response has already been sent — it can
// never block or affect the driver's success response.
// ---------------------------------------------------------------------
async function generateAndStorePdf(env, attemptId, submission) {
  try {
    const pdfBuffer = await buildResultPdf(env, { submission, questions: QUESTIONS });
    const r2Key = `exam-pdfs/${attemptId}.pdf`;
    await env.PDF_BUCKET.put(r2Key, pdfBuffer, { httpMetadata: { contentType: 'application/pdf' } });
    await markPdfStored(env, attemptId, r2Key);
    console.log(`PDF stored for attempt ${attemptId}: ${r2Key}`);
  } catch (err) {
    console.error(`PDF generation/storage failed for attempt ${attemptId}:`, err);
    await markPdfFailed(env, attemptId, err && err.message).catch(() => {});
  }
}

// ---------------------------------------------------------------------
// POST /api/submit
// Order: validate -> identify -> score -> save in D1 -> respond success.
// PDF/R2 happens in the background afterward and never blocks or loses
// the attempt if it fails (admin can retry it later).
// ---------------------------------------------------------------------
async function handleSubmit(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid json' }, 400);

  const requiredStrings = ['first', 'last', 'email', 'id', 'date'];
  for (const key of requiredStrings) {
    if (typeof body[key] !== 'string' || !body[key].trim()) {
      return json({ ok: false, error: `missing field: ${key}` }, 400);
    }
  }
  if (!EMAIL_RE.test(body.email.trim())) return json({ ok: false, error: 'invalid email' }, 400);
  if (!Array.isArray(body.answers) || body.answers.length !== QUESTIONS.length) {
    return json({ ok: false, error: 'invalid answers array' }, 400);
  }
  const submissionToken = typeof body.submissionToken === 'string' ? body.submissionToken.trim().slice(0, 100) : '';
  if (!submissionToken) return json({ ok: false, error: 'missing submissionToken' }, 400);

  // Idempotent retry: this exact submission already exists — never
  // rescore or duplicate, just confirm success again.
  const existing = await findAttemptByToken(env, submissionToken);
  if (existing) {
    return json({
      ok: true,
      score: existing.score,
      passed: !!existing.passed,
      passingScore: existing.passing_score_at_submission,
    });
  }

  const nationalId = body.id.trim().slice(0, 50);
  const employee = await findEmployeeByNationalId(env, nationalId);

  let employeeId = null;
  let isGuest = true;
  let isRequired = false;
  let firstName = body.first.trim().slice(0, 100);
  let lastName = body.last.trim().slice(0, 100);
  let employeeNo = typeof body.empnum === 'string' ? body.empnum.trim().slice(0, 50) : '';
  let canDoAgain = false;

  if (employee && employee.is_active) {
    employeeId = employee.id;
    isGuest = false;
    isRequired = !!employee.is_required;
    firstName = employee.first_name;
    lastName = employee.last_name;
    employeeNo = employee.employee_no || '';
    canDoAgain = !!employee.can_do_again;

    // Every required driver follows the same rule — one attempt by
    // default, one additional attempt if an admin sets can_do_again.
    if (isRequired) {
      const already = await hasCompletedAttempt(env, employeeId);
      if (already && !canDoAgain) {
        return json({ ok: false, error: 'already_completed', message: ALREADY_COMPLETED_MESSAGE }, 403);
      }
    }
  }

  // Read once per submission so every attempt's `passed` reflects the
  // threshold actually in effect at that moment — never trust a
  // client-sent pass/fail, and never recompute this later from a
  // possibly-changed system_settings value.
  const passingScore = await getPassingScore(env);

  let correct = 0;
  const answersDetailed = body.answers.map((a, i) => {
    const isCorrect = a === QUESTIONS[i].correct;
    if (isCorrect) correct++;
    return { questionIndex: i, chosen: a, correct: QUESTIONS[i].correct, isCorrect };
  });
  const score = Math.round((correct / QUESTIONS.length) * 100);
  const passed = score >= passingScore;

  const email = body.email.trim().slice(0, 200);
  const dateField = body.date.trim().slice(0, 20);
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 5) : 'he';
  const questionsSnapshot = JSON.stringify(QUESTIONS.map((q, i) => ({ index: i, q: q.q, opts: q.opts, correct: q.correct })));
  const answersJson = JSON.stringify(answersDetailed);
  const statisticsJson = JSON.stringify({ correctCount: correct, incorrectCount: QUESTIONS.length - correct });
  const submittedAt = new Date().toISOString();

  console.log(`New ${isGuest ? 'guest' : 'driver'} submission — id ${maskId(nationalId)}, score ${score}`);

  const attemptId = await createCompletedAttempt(env, {
    employeeId, isGuest, firstName, lastName, employeeNo, nationalId,
    submissionToken, email, dateField, lang,
    score, correctCount: correct, passed, passingScoreAtSubmission: passingScore,
    submittedAt, questionsSnapshot, answersJson, statisticsJson,
  });

  if (employeeId && canDoAgain) {
    // The one-time override has now been used for this successful attempt.
    await resetCanDoAgain(env, employeeId);
  }

  const submission = {
    first: firstName, last: lastName, email, id: nationalId, empnum: employeeNo, date: dateField, lang,
    answers: body.answers, correct, score, passed, passingScore,
  };
  ctx.waitUntil(generateAndStorePdf(env, attemptId, submission));

  return json({ ok: true, score, passed, passingScore });
}

// ---------------------------------------------------------------------
// Admin: HTML shell (GET /admin, /admin/*)
// ---------------------------------------------------------------------
async function handleAdminPage(request, env, pathAfterAdmin) {
  const admin = await getAdminFromRequest(request, env);
  if (!admin) {
    return new Response(buildLoginPage(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
  return new Response(
    buildDashboardPage({ displayName: admin.displayName, csrfToken: admin.csrfToken, initialRoute: pathAfterAdmin }),
    { headers: { 'Content-Type': 'text/html; charset=UTF-8' } },
  );
}

// ---------------------------------------------------------------------
// Admin: JSON API (all under /api/admin/*) — every route re-checks the
// session itself; state-changing (non-GET) routes additionally require a
// matching CSRF header.
// ---------------------------------------------------------------------
async function handleAdminApi(request, env, path) {
  if (path === '/api/admin/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }

  const admin = await getAdminFromRequest(request, env);
  if (!admin) return json({ ok: false, error: 'unauthorized' }, 401);

  if (request.method !== 'GET' && !checkCsrf(request, admin)) {
    return json({ ok: false, error: 'csrf_check_failed' }, 403);
  }

  if (path === '/api/admin/logout' && request.method === 'POST') return handleLogout(request, env, admin);
  if (path === '/api/admin/me' && request.method === 'GET') return handleMe(admin);
  if (path === '/api/admin/overview' && request.method === 'GET') return handleOverview(env);
  if (path === '/api/admin/statistics' && request.method === 'GET') return handleStatistics(env);
  if (path === '/api/admin/drivers' && request.method === 'GET') return handleDrivers(request, env);
  if (path === '/api/admin/incomplete' && request.method === 'GET') return handleIncomplete(env);
  if (path === '/api/admin/guests' && request.method === 'GET') return handleGuests(env);
  if (path === '/api/admin/settings/passing-score' && request.method === 'GET') return handleGetPassingScore(env);
  if (path === '/api/admin/settings/passing-score' && request.method === 'PUT') return handleSetPassingScore(request, env, admin);

  let m;
  if ((m = path.match(/^\/api\/admin\/drivers\/(\d+)$/)) && request.method === 'GET') {
    return handleDriverDetail(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/admin\/drivers\/(\d+)\/can-do-again$/)) && request.method === 'POST') {
    return handleCanDoAgain(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/admin\/attempts\/(\d+)$/)) && request.method === 'GET') {
    return handleAttemptDetail(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/admin\/attempts\/(\d+)\/retry-pdf$/)) && request.method === 'POST') {
    return handleRetryPdf(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/admin\/attempts\/(\d+)\/pdf$/)) && request.method === 'GET') {
    return handleAttemptPdf(env, Number(m[1]));
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/employee/verify' && request.method === 'POST') return handleVerify(request, env);
    if (path === '/api/submit' && request.method === 'POST') return handleSubmit(request, env, ctx);

    if (path.startsWith('/api/admin/')) return handleAdminApi(request, env, path);

    if (path === '/admin' || path.startsWith('/admin/')) {
      return handleAdminPage(request, env, path.slice('/admin'.length).replace(/^\//, ''));
    }

    // Under the normal Workers+assets deployment, a matching static file
    // (public/index.html, public/assets/*) is served before this fetch
    // handler ever runs, so this line is normally unreached for real
    // asset paths — it's here for a Pages deployment (see public/_worker.js),
    // where every request reaches the worker and env.ASSETS.fetch() is
    // what actually serves the static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
