// Exam attempt storage + the idempotency/one-attempt logic around it.

export async function findAttemptByToken(env, submissionToken) {
  const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE submission_token = ?')
    .bind(submissionToken)
    .first();
  return row || null;
}

// "Already completed" = has a *sent* attempt. A 'failed' or 'pending' one
// (e.g. because Resend hiccuped) does not block a fresh retry — we don't
// want to penalize a driver for our email service, and the retry path
// (findAttemptByToken) is how a same-session retry avoids a full retake.
export async function hasSentAttempt(env, employeeId) {
  const row = await env.DB.prepare(
    "SELECT id FROM exam_attempts WHERE employee_id = ? AND is_guest = 0 AND email_status = 'sent' LIMIT 1",
  )
    .bind(employeeId)
    .first();
  return !!row;
}

export async function createPendingAttempt(env, data) {
  const {
    employeeId, isGuest, firstName, lastName, employeeNo, nationalId, submissionToken,
    email, dateField, lang, score, correctCount, passed,
    startedAt, submittedAt, questionsSnapshot, answersJson, statisticsJson,
  } = data;

  const result = await env.DB.prepare(
    `INSERT INTO exam_attempts
      (employee_id, is_guest, first_name, last_name, employee_no, national_id, submission_token,
       email, date_field, lang, score, correct_count, passed,
       started_at, submitted_at, email_status,
       questions_snapshot, answers_json, statistics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      employeeId ?? null, isGuest ? 1 : 0, firstName, lastName, employeeNo ?? null, nationalId, submissionToken,
      email, dateField, lang, score, correctCount, passed ? 1 : 0,
      startedAt ?? null, submittedAt,
      questionsSnapshot, answersJson, statisticsJson,
    )
    .run();

  return result.meta.last_row_id;
}

export async function markAttemptSent(env, attemptId) {
  await env.DB.prepare(
    "UPDATE exam_attempts SET email_status = 'sent', email_sent_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP, email_error = NULL WHERE id = ?",
  )
    .bind(attemptId)
    .run();
}

export async function markAttemptFailed(env, attemptId, errorMessage) {
  await env.DB.prepare("UPDATE exam_attempts SET email_status = 'failed', email_error = ? WHERE id = ?")
    .bind(String(errorMessage || '').slice(0, 500), attemptId)
    .run();
}

// The single "accepted" attempt per required driver for reporting: the
// most recently *sent* one. If can_do_again allowed a second attempt, the
// newer result supersedes the first for the report/statistics.
export async function listAcceptedRequiredDriverAttempts(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.*
     FROM exam_attempts a
     JOIN employees e ON e.id = a.employee_id
     INNER JOIN (
       SELECT employee_id, MAX(submitted_at) AS max_submitted
       FROM exam_attempts
       WHERE is_guest = 0 AND email_status = 'sent'
       GROUP BY employee_id
     ) latest ON latest.employee_id = a.employee_id AND latest.max_submitted = a.submitted_at
     WHERE a.is_guest = 0 AND a.email_status = 'sent'
       AND e.role = 'driver' AND e.is_required = 1
     ORDER BY e.employee_no`,
  ).all();
  return results || [];
}
