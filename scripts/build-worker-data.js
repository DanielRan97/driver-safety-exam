// Generates worker/generated/{questions,fonts}.json before `wrangler dev`/
// `deploy`. Cloudflare Workers have no runtime filesystem, so anything the
// Worker needs from disk (the question bank, the embedded PDF fonts) has to
// be bundled in at build time instead of read with fs at request time —
// this script is that build step, run via `npm run build:worker-data`.
//
// The question bank is still parsed directly out of public/index.html (same
// regex/validation as server/questions.js), so it stays the single source
// of truth — this script just moves the read from "request time" to
// "build time", it doesn't duplicate the data by hand.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXAM_HTML_PATH = path.join(ROOT, 'public', 'index.html');
const FONTS_DIR = path.join(ROOT, 'server', 'fonts');
const OUT_DIR = path.join(ROOT, 'worker', 'generated');

function extractQuestions() {
  const html = fs.readFileSync(EXAM_HTML_PATH, 'utf8');
  const match = html.match(/var QUESTIONS_HE\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('Could not find QUESTIONS_HE in public/index.html — question bank parsing failed.');
  }

  let questions;
  try {
    // Same approach as server/questions.js: QUESTIONS_HE is a plain JS
    // array literal (not strict JSON), evaluated from our own source file.
    questions = new Function('return ' + match[1])();
  } catch (err) {
    throw new Error('Failed to parse QUESTIONS_HE from public/index.html: ' + err.message);
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

function extractFonts() {
  return {
    hebrew: fs.readFileSync(path.join(FONTS_DIR, 'heebo-hebrew.woff2')).toString('base64'),
    latin: fs.readFileSync(path.join(FONTS_DIR, 'heebo-latin.woff2')).toString('base64'),
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'questions.json'), JSON.stringify(extractQuestions()));
fs.writeFileSync(path.join(OUT_DIR, 'fonts.json'), JSON.stringify(extractFonts()));
console.log('Generated worker/generated/questions.json and fonts.json from public/index.html + server/fonts/');
