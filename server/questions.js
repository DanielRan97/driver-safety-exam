// Single source of truth for the question bank: parsed directly out of
// public/exam.html (the QUESTIONS_HE array) so the server can never drift
// from the exam the driver actually takes.
const fs = require('fs');
const path = require('path');

const EXAM_HTML_PATH = path.join(__dirname, '..', 'public', 'exam.html');
const PASS_SCORE = 100;

function getQuestions() {
  const html = fs.readFileSync(EXAM_HTML_PATH, 'utf8');
  const match = html.match(/var QUESTIONS_HE\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('Could not find QUESTIONS_HE in public/exam.html — question bank parsing failed.');
  }

  let questions;
  try {
    // QUESTIONS_HE is a plain JS array literal (not strict JSON), so it is
    // evaluated rather than JSON.parse'd. The source is our own file, not
    // user input.
    questions = new Function('return ' + match[1])();
  } catch (err) {
    throw new Error('Failed to parse QUESTIONS_HE from public/exam.html: ' + err.message);
  }

  if (!Array.isArray(questions) || questions.length !== 20) {
    throw new Error(`Parsed QUESTIONS_HE has unexpected shape (length=${questions && questions.length}).`);
  }
  questions.forEach((q, i) => {
    if (!q.q || !Array.isArray(q.opts) || q.opts.length !== 4 || typeof q.correct !== 'number') {
      throw new Error(`Question ${i} has an unexpected shape.`);
    }
  });

  return questions;
}

module.exports = { getQuestions, PASS_SCORE };
