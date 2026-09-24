require('dotenv').config();

const express = require('express');
const path = require('path');

const { getQuestions, PASS_SCORE } = require('./questions');
const { buildResultPdf, closeBrowser } = require('./pdf');
const { sendResultEmail } = require('./mailer');
const { logSubmission } = require('./storage');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const QUESTIONS = getQuestions(); // parsed once at boot from public/index.html

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.post('/api/submit', async (req, res) => {
  try {
    const body = req.body || {};
    const requiredStrings = ['first', 'last', 'email', 'id', 'empnum', 'date'];
    for (const key of requiredStrings) {
      if (typeof body[key] !== 'string' || !body[key].trim()) {
        return res.status(400).json({ ok: false, error: `missing field: ${key}` });
      }
    }
    if (!EMAIL_RE.test(body.email.trim())) {
      return res.status(400).json({ ok: false, error: 'invalid email' });
    }
    if (!Array.isArray(body.answers) || body.answers.length !== QUESTIONS.length) {
      return res.status(400).json({ ok: false, error: 'invalid answers array' });
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

    // Backup log first, independent of email success.
    logSubmission(submission).catch((err) => {
      console.error('CSV backup log failed:', err);
    });

    const pdfBuffer = await buildResultPdf({ submission, questions: QUESTIONS });
    console.log(`Generated PDF: ${pdfBuffer.length} bytes, starts with: ${Buffer.from(pdfBuffer.subarray(0, 8)).toString('latin1')}`);
    await sendResultEmail({ submission, pdfBuffer });

    res.json({ ok: true, score, passed });
  } catch (err) {
    console.error('POST /api/submit failed:', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Driver safety exam server listening on port ${PORT}`);
});

async function shutdown() {
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
