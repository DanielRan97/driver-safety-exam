// Cloudflare Worker entry point. Static files (public/index.html,
// public/assets/*) are served directly by the Workers "assets" binding
// before requests ever reach this code — this file handles the two real
// API routes: POST /api/employee/verify and POST /api/submit.
import { getQuestions, PASS_SCORE } from './questions.js';
import { buildResultPdf } from './pdf.js';
import { sendResultEmail, sendFinalReportEmail } from './mailer.js';
import { buildDriversExcelBase64 } from './excel.js';
import { computeCampaignStatistics } from './stats.js';
import {
  findEmployeeByNationalId, countRequiredDrivers, countCompletedRequiredDrivers, resetCanDoAgain,
} from './db/employees.js';
import {
  findAttemptByToken, hasSentAttempt, createPendingAttempt, markAttemptSent, markAttemptFailed,
  listAcceptedRequiredDriverAttempts,
} from './db/attempts.js';
import { tryClaimFinalReport } from './db/campaign.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUESTIONS = getQuestions();
const ALREADY_COMPLETED_MESSAGE = 'כבר השלמת בהצלחה את מבחן הבטיחות. אם לדעתך זו טעות, פנה למנהל.';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Never log a full national ID (security requirement) — only enough to
// correlate log lines with a person if needed.
function maskId(id) {
  const s = String(id || '');
  return s.length <= 3 ? '***' : `***${s.slice(-3)}`;
}

// ---------------------------------------------------------------------
// POST /api/employee/verify — identifies a driver server-side by national
// ID. Returns only safe fields; never echoes the national ID back.
// ---------------------------------------------------------------------
async function handleVerify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'invalid json' }, 400);
  }
  const nationalId = typeof body?.nationalId === 'string' ? body.nationalId.trim().slice(0, 50) : '';
  if (!nationalId) {
    return json({ status: 'error', message: 'missing nationalId' }, 400);
  }

  const employee = await findEmployeeByNationalId(env, nationalId);
  if (!employee || !employee.is_active) {
    return json({ status: 'guest' });
  }

  const isTester = employee.role === 'tester';
  const isRequired = !!employee.is_required;

  if (!isTester && isRequired) {
    const alreadySent = await hasSentAttempt(env, employee.id);
    if (alreadySent && !employee.can_do_again) {
      return json({ status: 'blocked', message: ALREADY_COMPLETED_MESSAGE });
    }
  }

  return json({
    status: 'ok',
    employee: {
      firstName: employee.first_name,
      lastName: employee.last_name,
      employeeNo: employee.employee_no,
      isTester,
    },
  });
}

// ---------------------------------------------------------------------
// Shared tail-end of a submission: generate the PDF, send the result
// email (with progress for required drivers), mark the attempt sent/
// failed, reset a used can_do_again override, and — if this was the last
// required driver — send the one-time final report. Used for both a
// fresh submission and a same-token retry.
// ---------------------------------------------------------------------
async function finishAttempt(env, attemptRow, { employeeCanDoAgain } = {}) {
  const submission = {
    first: attemptRow.first_name,
    last: attemptRow.last_name,
    email: attemptRow.email,
    id: attemptRow.national_id,
    empnum: attemptRow.employee_no,
    date: attemptRow.date_field,
    lang: attemptRow.lang,
    answers: JSON.parse(attemptRow.answers_json).map((a) => a.chosen),
    correct: attemptRow.correct_count,
    score: attemptRow.score,
    passed: !!attemptRow.passed,
  };
  const isGuest = !!attemptRow.is_guest;
  const isTester = !!attemptRow.__isTester;

  try {
    const pdfBuffer = await buildResultPdf(env, { submission, questions: QUESTIONS });
    console.log(`Generated PDF: ${pdfBuffer.length} bytes for attempt ${attemptRow.id}`);

    let progress = null;
    // Only a required driver's *own* completion moves the campaign
    // progress/final-report needle — guests, testers, and any
    // non-required employee are excluded, per spec.
    const isRequiredCompletion = !isGuest && !isTester && !!attemptRow.__isRequired;
    if (isRequiredCompletion) {
      const [completed, total] = await Promise.all([
        countCompletedRequiredDrivers(env),
        countRequiredDrivers(env),
      ]);
      progress = { completed, total };
    }

    await sendResultEmail(env, {
      submission,
      pdfBuffer,
      progress,
      isGuest,
      isTester,
    });

    await markAttemptSent(env, attemptRow.id);

    if (attemptRow.employee_id && employeeCanDoAgain) {
      await resetCanDoAgain(env, attemptRow.employee_id);
    }

    // Last required driver? Send the one-time final report. Guarded by an
    // atomic UPDATE so concurrent completions can't double-send it.
    if (isRequiredCompletion && progress && progress.total > 0 && progress.completed >= progress.total) {
      const won = await tryClaimFinalReport(env);
      if (won) {
        try {
          const accepted = await listAcceptedRequiredDriverAttempts(env);
          const stats = computeCampaignStatistics(accepted, QUESTIONS);
          const excelBase64 = buildDriversExcelBase64(accepted, QUESTIONS.length);
          await sendFinalReportEmail(env, { excelBase64, stats });
        } catch (err) {
          // The gate is already claimed; log loudly so this can be
          // regenerated manually (see CLOUDFLARE.md) rather than retried
          // automatically and risking a duplicate send.
          console.error('Final report generation/send failed after claiming the gate:', err);
        }
      }
    }

    return json({ ok: true, score: attemptRow.score, passed: !!attemptRow.passed });
  } catch (err) {
    console.error(`finishAttempt failed for attempt ${attemptRow.id}:`, err);
    await markAttemptFailed(env, attemptRow.id, err && err.message).catch(() => {});
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

// ---------------------------------------------------------------------
// POST /api/submit
// ---------------------------------------------------------------------
async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'invalid json' }, 400);
  }

  const requiredStrings = ['first', 'last', 'email', 'id', 'date'];
  for (const key of requiredStrings) {
    if (typeof body[key] !== 'string' || !body[key].trim()) {
      return json({ ok: false, error: `missing field: ${key}` }, 400);
    }
  }
  if (!EMAIL_RE.test(body.email.trim())) {
    return json({ ok: false, error: 'invalid email' }, 400);
  }
  if (!Array.isArray(body.answers) || body.answers.length !== QUESTIONS.length) {
    return json({ ok: false, error: 'invalid answers array' }, 400);
  }
  const submissionToken = typeof body.submissionToken === 'string' ? body.submissionToken.trim().slice(0, 100) : '';
  if (!submissionToken) {
    return json({ ok: false, error: 'missing submissionToken' }, 400);
  }

  // ---- Idempotent retry: same token as a previous attempt ----
  const existing = await findAttemptByToken(env, submissionToken);
  if (existing) {
    if (existing.email_status === 'sent') {
      return json({ ok: true, score: existing.score, passed: !!existing.passed });
    }
    let employeeCanDoAgain = false;
    if (existing.employee_id) {
      const emp = await findEmployeeByNationalId(env, existing.national_id);
      employeeCanDoAgain = !!(emp && emp.can_do_again);
      existing.__isTester = emp ? emp.role === 'tester' : false;
      existing.__isRequired = emp ? !!emp.is_required : false;
    }
    return finishAttempt(env, existing, { employeeCanDoAgain });
  }

  // ---- Fresh submission: identify the driver server-side ----
  const nationalId = body.id.trim().slice(0, 50);
  const employee = await findEmployeeByNationalId(env, nationalId);

  let employeeId = null;
  let isGuest = true;
  let isTester = false;
  let isRequired = false;
  let firstName = body.first.trim().slice(0, 100);
  let lastName = body.last.trim().slice(0, 100);
  let employeeNo = typeof body.empnum === 'string' ? body.empnum.trim().slice(0, 50) : '';
  let canDoAgain = false;

  if (employee && employee.is_active) {
    employeeId = employee.id;
    isGuest = false;
    isTester = employee.role === 'tester';
    isRequired = !!employee.is_required;
    firstName = employee.first_name;
    lastName = employee.last_name;
    employeeNo = employee.employee_no || '';
    canDoAgain = !!employee.can_do_again;

    if (!isTester && isRequired) {
      const alreadySent = await hasSentAttempt(env, employeeId);
      if (alreadySent && !canDoAgain) {
        return json({ ok: false, error: 'already_completed', message: ALREADY_COMPLETED_MESSAGE }, 403);
      }
    }
  }

  let correct = 0;
  const answersDetailed = body.answers.map((a, i) => {
    const isCorrect = a === QUESTIONS[i].correct;
    if (isCorrect) correct++;
    return { questionIndex: i, chosen: a, correct: QUESTIONS[i].correct, isCorrect };
  });
  const score = Math.round((correct / QUESTIONS.length) * 100);
  const passed = score >= PASS_SCORE;

  const email = body.email.trim().slice(0, 200);
  const dateField = body.date.trim().slice(0, 20);
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 5) : 'he';
  const questionsSnapshot = JSON.stringify(QUESTIONS.map((q, i) => ({ index: i, q: q.q, opts: q.opts, correct: q.correct })));
  const answersJson = JSON.stringify(answersDetailed);
  const statisticsJson = JSON.stringify({ correctCount: correct, incorrectCount: QUESTIONS.length - correct });
  const submittedAt = new Date().toISOString();

  console.log(`New ${isGuest ? 'guest' : isTester ? 'tester' : 'driver'} submission — id ${maskId(nationalId)}, score ${score}`);

  const attemptId = await createPendingAttempt(env, {
    employeeId, isGuest, firstName, lastName, employeeNo, nationalId,
    submissionToken, email, dateField, lang,
    score, correctCount: correct, passed,
    submittedAt, questionsSnapshot, answersJson, statisticsJson,
  });

  const attemptRow = {
    id: attemptId,
    employee_id: employeeId,
    is_guest: isGuest ? 1 : 0,
    first_name: firstName,
    last_name: lastName,
    employee_no: employeeNo,
    national_id: nationalId,
    email,
    date_field: dateField,
    lang,
    score,
    correct_count: correct,
    passed: passed ? 1 : 0,
    answers_json: answersJson,
    __isTester: isTester,
    __isRequired: isRequired,
  };

  return finishAttempt(env, attemptRow, { employeeCanDoAgain: canDoAgain });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/employee/verify' && request.method === 'POST') {
      return handleVerify(request, env);
    }
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
