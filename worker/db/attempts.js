// Exam attempt storage + the idempotency/one-attempt logic around it.
//
// Completion no longer depends on email (that reporting channel was
// removed) — an attempt is "completed" as soon as it's written to D1 with
// a score, which happens synchronously before this ever returns. PDF
// generation/storage in R2 is a separate, best-effort background step
// tracked by pdf_status, and never blocks or reverses completion.

export async function findAttemptByToken(env, submissionToken) {
  const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE submission_token = ?')
    .bind(submissionToken)
    .first();
  return row || null;
}

// "Already completed" = has any stored (non-guest) attempt at all — the
// old email_status='sent' gate doesn't apply anymore, since completion no
// longer depends on email.
export async function hasCompletedAttempt(env, employeeId) {
  const row = await env.DB.prepare(
    'SELECT id FROM exam_attempts WHERE employee_id = ? AND is_guest = 0 LIMIT 1',
  )
    .bind(employeeId)
    .first();
  return !!row;
}

export async function createCompletedAttempt(env, data) {
  const {
    employeeId, isGuest, firstName, lastName, employeeNo, nationalId, submissionToken,
    email, dateField, lang, score, correctCount, passed, passingScoreAtSubmission,
    startedAt, submittedAt, questionsSnapshot, answersJson, statisticsJson,
  } = data;

  // email_status is left at its schema default ('pending') — it's a
  // vestige of the removed email-reporting flow, no longer meaningful,
  // and 'sent' would be actively false now that no email is sent.
  //
  // passing_score_at_submission snapshots the threshold actually in
  // effect for this attempt — a later change to system_settings must
  // never change what this specific attempt's `passed` value means.
  const result = await env.DB.prepare(
    `INSERT INTO exam_attempts
      (employee_id, is_guest, first_name, last_name, employee_no, national_id, submission_token,
       email, date_field, lang, score, correct_count, passed, passing_score_at_submission,
       started_at, submitted_at, completed_at, pdf_status,
       questions_snapshot, answers_json, statistics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending', ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      employeeId ?? null, isGuest ? 1 : 0, firstName, lastName, employeeNo ?? null, nationalId, submissionToken,
      email, dateField, lang, score, correctCount, passed ? 1 : 0, passingScoreAtSubmission ?? null,
      startedAt ?? null, submittedAt,
      questionsSnapshot, answersJson, statisticsJson,
    )
    .run();

  return result.meta.last_row_id;
}

export async function markPdfStored(env, attemptId, r2Key) {
  await env.DB.prepare(
    "UPDATE exam_attempts SET pdf_status = 'stored', pdf_r2_key = ?, pdf_created_at = CURRENT_TIMESTAMP, pdf_error = NULL WHERE id = ?",
  )
    .bind(r2Key, attemptId)
    .run();
}

export async function markPdfFailed(env, attemptId, errorMessage) {
  await env.DB.prepare("UPDATE exam_attempts SET pdf_status = 'failed', pdf_error = ? WHERE id = ?")
    .bind(String(errorMessage || '').slice(0, 500), attemptId)
    .run();
}

export async function getAttemptById(env, attemptId) {
  const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE id = ?').bind(attemptId).first();
  return row || null;
}

export async function listAttemptsForEmployee(env, employeeId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM exam_attempts WHERE employee_id = ? ORDER BY submitted_at DESC',
  )
    .bind(employeeId)
    .all();
  return results || [];
}

// The single "accepted" attempt per required driver for reporting: the
// most recent one. If can_do_again allowed a second attempt, the newer
// result supersedes the first for statistics/the drivers table.
export async function listAcceptedRequiredDriverAttempts(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.*
     FROM exam_attempts a
     JOIN employees e ON e.id = a.employee_id
     INNER JOIN (
       SELECT employee_id, MAX(submitted_at) AS max_submitted
       FROM exam_attempts
       WHERE is_guest = 0
       GROUP BY employee_id
     ) latest ON latest.employee_id = a.employee_id AND latest.max_submitted = a.submitted_at
     WHERE a.is_guest = 0
       AND e.role = 'driver' AND e.is_required = 1
     ORDER BY e.employee_no`,
  ).all();
  return results || [];
}

export async function listGuestAttempts(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM exam_attempts WHERE is_guest = 1 ORDER BY submitted_at DESC",
  ).all();
  return results || [];
}

