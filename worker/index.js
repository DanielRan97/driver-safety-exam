// Cloudflare Worker entry point. Static files (public/index.html,
// public/assets/*) are served directly by the Workers "assets" binding
// before requests ever reach this code (see wrangler.jsonc's `assets`
// block and `run_worker_first: false`) — this file only handles the one
// real API route, POST /api/submit, which is the same endpoint and same
// validation/scoring logic as server/index.js on Render.
import { getQuestions, PASS_SCORE } from './questions.js';
import { buildResultPdf } from './pdf.js';
import { sendResultEmail } from './mailer.js';
import { logSubmission } from './storage.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUESTIONS = getQuestions();

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  const requiredStrings = ['first', 'last', 'email', 'id', 'empnum', 'date'];
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

  let correct = 0;
  body.answers.forEach((a, i) => {
    if (a === QUESTIONS[i].correct) correct++;
  });
  const score = Math.round((correct / QUESTIONS.length) * 100);
  const passed = score >= PASS_SCORE;

  const submission = {
    first: body.first.trim().slice(0, 100),
    last: body.last.trim().slice(0, 100),
    email: body.email.trim().slice(0, 200),
    id: body.id.trim().slice(0, 50),
    empnum: body.empnum.trim().slice(0, 50),
    date: body.date.trim().slice(0, 20),
    lang: typeof body.lang === 'string' ? body.lang.slice(0, 5) : 'he',
    answers: body.answers,
    correct,
    score,
    passed,
    submittedAt: new Date().toISOString(),
  };

  try {
    // Backup log first, independent of email success.
    try {
      await logSubmission(env, submission);
    } catch (err) {
      console.error('KV backup log failed:', err);
    }

    const pdfBuffer = await buildResultPdf(env, { submission, questions: QUESTIONS });
    console.log(`Generated PDF: ${pdfBuffer.length} bytes`);
    await sendResultEmail(env, { submission, pdfBuffer });

    return json({ ok: true, score, passed });
  } catch (err) {
    console.error('POST /api/submit failed:', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    // Anything else that reaches the Worker (rather than being served
    // directly as a static asset) has no route here.
    return new Response('Not found', { status: 404 });
  },
};
