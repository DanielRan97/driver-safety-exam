import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

function validSubmitPayload(overrides = {}) {
  return {
    first: 'שם',
    last: 'משפחה',
    email: 'test@example.com',
    id: overrides.id || `8${Math.floor(Math.random() * 1e8)}`.padStart(9, '0'),
    empnum: '',
    date: '2026-09-27',
    lang: 'he',
    answers: new Array(20).fill(0),
    submissionToken: overrides.submissionToken || crypto.randomUUID(),
    ...overrides,
  };
}

async function submit(payload) {
  const res = await SELF.fetch('https://example.com/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('POST /api/submit — validation', () => {
  it('rejects a missing required field', async () => {
    const payload = validSubmitPayload();
    delete payload.first;
    const { status, body } = await submit(payload);
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('rejects an invalid email', async () => {
    const { status, body } = await submit(validSubmitPayload({ email: 'not-an-email' }));
    expect(status).toBe(400);
    expect(body.error).toBe('invalid email');
  });

  it('rejects a wrong-length answers array', async () => {
    const payload = validSubmitPayload();
    payload.answers = [0, 1, 2];
    const { status, body } = await submit(payload);
    expect(status).toBe(400);
    expect(body.error).toBe('invalid answers array');
  });

  it('rejects a missing submissionToken', async () => {
    const payload = validSubmitPayload();
    delete payload.submissionToken;
    const { status, body } = await submit(payload);
    expect(status).toBe(400);
    expect(body.error).toBe('missing submissionToken');
  });
});

describe('POST /api/submit — guest path', () => {
  // 4 (guest UX). Guest identification never matches an employee, so the
  // driver-typed name is preserved verbatim rather than being overwritten.
  it('stores a guest submission with is_guest=1 and the typed name', async () => {
    const token = crypto.randomUUID();
    await submit(validSubmitPayload({ submissionToken: token, first: 'אורח', last: 'זר' }));

    const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE submission_token = ?').bind(token).first();
    expect(row).not.toBeNull();
    expect(row.is_guest).toBe(1);
    expect(row.first_name).toBe('אורח');
    expect(row.last_name).toBe('זר');
  });

  // 10 / 12. Guests are never blocked and never counted as required drivers
  it('never blocks a guest across repeated submissions, and excludes them from the required count', async () => {
    const sameId = `7${Math.floor(Math.random() * 1e8)}`.padStart(9, '0');
    const before = await env.DB.prepare(
      "SELECT COUNT(DISTINCT employee_id) AS n FROM exam_attempts WHERE is_guest=0 AND email_status='sent'",
    ).first();

    const r1 = await submit(validSubmitPayload({ id: sameId }));
    const r2 = await submit(validSubmitPayload({ id: sameId }));
    // Neither call is blocked with already_completed (guests are never
    // subject to the one-attempt rule) — both fail only because Browser
    // Run/PDF generation isn't available in this local test runtime.
    expect(r1.body.error).not.toBe('already_completed');
    expect(r2.body.error).not.toBe('already_completed');

    const after = await env.DB.prepare(
      "SELECT COUNT(DISTINCT employee_id) AS n FROM exam_attempts WHERE is_guest=0 AND email_status='sent'",
    ).first();
    expect(after.n).toBe(before.n); // guest rows never contribute here
  });
});

describe('POST /api/submit — storage integrity + idempotency', () => {
  // 14 / 15 / 16. The full attempt (every answer, correct/incorrect,
  // score) is stored durably even when the downstream PDF/email step
  // fails — this local test runtime has no Browser Run binding, so every
  // call here genuinely exercises the failure path.
  it('stores every question/answer with correctness before the email step, and keeps it after a failure', async () => {
    const token = crypto.randomUUID();
    const answers = new Array(20).fill(0);
    answers[1] = 3; // deliberately wrong on one question, right on the rest per QUESTIONS_HE[i].correct
    const { body } = await submit(validSubmitPayload({ submissionToken: token, answers }));
    expect(body.ok).toBe(false); // PDF step fails locally — expected

    const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE submission_token = ?').bind(token).first();
    expect(row).not.toBeNull();
    expect(row.email_status).toBe('failed');
    const stored = JSON.parse(row.answers_json);
    expect(stored).toHaveLength(20);
    stored.forEach((a) => {
      expect(typeof a.isCorrect).toBe('boolean');
      expect(typeof a.correct).toBe('number');
    });
  });

  // 17. A retry with the SAME token does not create a second attempt row
  it('does not duplicate the attempt row when retried with the same submissionToken', async () => {
    const token = crypto.randomUUID();
    await submit(validSubmitPayload({ submissionToken: token }));
    await submit(validSubmitPayload({ submissionToken: token })); // retry, same token

    const { results } = await env.DB.prepare('SELECT id FROM exam_attempts WHERE submission_token = ?')
      .bind(token)
      .all();
    expect(results).toHaveLength(1);
  });
});
