// Append-only CSV backup of every submission, in case the email never
// arrives. Lives outside git (see .gitignore) — treat data/ as sensitive,
// it contains driver PII.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_PATH = path.join(DATA_DIR, 'submissions.csv');

const HEADERS = [
  'submittedAt', 'first', 'last', 'email', 'id', 'empnum', 'date',
  'lang', 'score', 'correct', 'passed', 'answers',
];

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function logSubmission(submission) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const isNew = !fs.existsSync(CSV_PATH);
  const row = [
    submission.submittedAt, submission.first, submission.last, submission.email,
    submission.id, submission.empnum, submission.date, submission.lang,
    submission.score, submission.correct, submission.passed,
    JSON.stringify(submission.answers),
  ].map(csvEscape).join(',') + '\n';

  if (isNew) {
    await fs.promises.writeFile(CSV_PATH, HEADERS.join(',') + '\n' + row, 'utf8');
  } else {
    await fs.promises.appendFile(CSV_PATH, row, 'utf8');
  }
}

module.exports = { logSubmission, CSV_PATH };
