// Populates the Admin Dashboard with temporary, clearly-marked demo exam
// attempts for every required driver who has not yet completed the real
// exam, so the dashboard can be previewed as if the campaign were fully
// completed (48/48).
//
// Every inserted row is marked is_demo=1 (migrations/0004_demo_marker.sql)
// so it can later be identified and removed precisely by
// scripts/reset-demo-completed-exams.js — nothing else in the database is
// touched: no employee rows are added/changed, no admin accounts, no
// testers, no guests, no real attempts.
//
// PDFs are deliberately NOT generated for demo attempts (would consume
// real Browser Run quota for fake data) — pdf_status is set to
// 'demo_not_generated' instead, which the admin PDF route already treats
// like any other non-'stored' status (404, no crash).
//
// Usage:
//   node scripts/seed-demo-completed-exams.js --local
//   node scripts/seed-demo-completed-exams.js --remote --confirm-production
//   node scripts/seed-demo-completed-exams.js --remote          (preview only, refuses to write)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runD1Command, runD1File, sqlEscape } = require('./lib/wrangler-exec');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const confirmed = args.includes('--confirm-production');
const target = remote ? '--remote' : '--local';
const dryRun = remote && !confirmed;

// Roughly realistic spread of wrong-answer counts across up to 48
// drivers — PASS_SCORE is 100 (worker/questions.js), so only a 0-wrong
// attempt actually passes; this still gives a wide score/bucket spread
// for the dashboard's statistics to visibly exercise.
const WRONG_COUNT_PLAN = [
  ...Array(10).fill(0), // 100 - pass
  ...Array(5).fill(1), // 95
  ...Array(3).fill(2), // 90
  ...Array(6).fill(3), // 85
  ...Array(4).fill(4), // 80
  ...Array(4).fill(5), // 75
  ...Array(4).fill(6), // 70
  ...Array(4).fill(7), // 65
  ...Array(3).fill(8), // 60
  ...Array(3).fill(9), // 55
  ...Array(2).fill(10), // 50
];

const LANG_POOL = [
  ...Array(24).fill('he'),
  ...Array(12).fill('en'),
  ...Array(8).fill('ar'),
  ...Array(4).fill('ru'),
];

// Deterministic PRNG (mulberry32) so a --remote dry-run preview and the
// eventual real write (once re-run with --confirm-production) assign the
// exact same scores/langs/timestamps — no surprises between preview and
// execution.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260927);

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readPassScore() {
  // worker/questions.js statically imports generated/questions.json
  // without a JSON import attribute, which Node's own ESM loader
  // requires but Wrangler's bundler does not — so it can't be imported
  // directly from a plain Node script. Reading the constant out of its
  // source text (rather than hardcoding a second copy) keeps this in
  // sync with the real value without touching that production file.
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'questions.js'), 'utf8');
  const match = src.match(/PASS_SCORE\s*=\s*(\d+)/);
  if (!match) throw new Error('Could not determine PASS_SCORE from worker/questions.js');
  return Number(match[1]);
}

async function main() {
  const PASS_SCORE = readPassScore();
  const QUESTIONS = require('../worker/generated/questions.json');

  // Fixed per-question difficulty weight (deterministic) so "most missed
  // questions" in the dashboard looks organically uneven rather than
  // perfectly uniform across all 20 questions.
  const questionWeights = QUESTIONS.map((_, i) => 0.4 + mulberry32(1000 + i)() * 1.6);
  function pickWrongIndexes(count) {
    const weighted = QUESTIONS.map((_, i) => ({ i, w: questionWeights[i] * rng() }));
    weighted.sort((a, b) => b.w - a.w);
    return weighted.slice(0, count).map((x) => x.i);
  }
  function randomRecentTimestamp() {
    const now = Date.now();
    const daysAgo = rng() * 13; // spread over the last ~13 days
    const t = new Date(now - daysAgo * 24 * 3600 * 1000);
    t.setHours(7 + Math.floor(rng() * 11), Math.floor(rng() * 60), Math.floor(rng() * 60), 0);
    return t;
  }

  console.log(`Fetching required drivers with no completed attempt (${target})...`);
  const incomplete = runD1Command(
    `SELECT e.id, e.first_name, e.last_name, e.employee_no, e.national_id
     FROM employees e
     WHERE e.role='driver' AND e.is_required=1 AND e.is_active=1
       AND e.id NOT IN (SELECT DISTINCT employee_id FROM exam_attempts WHERE is_guest=0 AND employee_id IS NOT NULL)
     ORDER BY e.employee_no`,
    { remote },
  );

  if (incomplete.length === 0) {
    console.log('No incomplete required drivers found — nothing to seed (every required driver already has an attempt).');
    return;
  }
  if (incomplete.length > WRONG_COUNT_PLAN.length) {
    console.error(`Found ${incomplete.length} incomplete drivers but the score plan only covers ${WRONG_COUNT_PLAN.length} — aborting rather than guessing at a distribution.`);
    process.exit(1);
  }

  const wrongCounts = shuffled(WRONG_COUNT_PLAN).slice(0, incomplete.length);
  const langs = shuffled(LANG_POOL).slice(0, incomplete.length);

  const rows = incomplete.map((emp, idx) => {
    const wrongIdx = new Set(pickWrongIndexes(wrongCounts[idx]));
    const answers = QUESTIONS.map((q, i) => {
      const isCorrect = !wrongIdx.has(i);
      let chosen = q.correct;
      if (!isCorrect) {
        do { chosen = Math.floor(rng() * q.opts.length); } while (chosen === q.correct);
      }
      return { questionIndex: i, chosen, correct: q.correct, isCorrect };
    });
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const score = Math.round((correctCount / QUESTIONS.length) * 100);
    return {
      employee: emp,
      lang: langs[idx],
      score,
      correctCount,
      passed: score >= PASS_SCORE,
      submittedAt: randomRecentTimestamp(),
      answers,
      submissionToken: crypto.randomUUID(),
    };
  });

  console.log(`\nPlanned demo attempts (${rows.length}):`);
  console.log('employee_no  name                      score  passed  lang  submitted_at');
  [...rows].sort((a, b) => a.submittedAt - b.submittedAt).forEach((r) => {
    console.log(
      `${(r.employee.employee_no || '').padEnd(12)} ${`${r.employee.first_name} ${r.employee.last_name}`.padEnd(25)} ${String(r.score).padStart(3)}    ${r.passed ? 'yes' : 'no '}     ${r.lang}    ${r.submittedAt.toISOString()}`,
    );
  });
  const scoreCounts = rows.reduce((acc, r) => { acc[r.score] = (acc[r.score] || 0) + 1; return acc; }, {});
  const langCounts = rows.reduce((acc, r) => { acc[r.lang] = (acc[r.lang] || 0) + 1; return acc; }, {});
  console.log(`\nScore distribution: ${JSON.stringify(scoreCounts)}`);
  console.log(`Passed (score===${PASS_SCORE}): ${rows.filter((r) => r.passed).length} / ${rows.length}`);
  console.log(`Language distribution: ${JSON.stringify(langCounts)}`);
  console.log("All rows will be inserted with is_demo=1 and pdf_status='demo_not_generated' (no PDFs generated for demo data).");

  if (dryRun) {
    console.log('\nDry run only (remote without --confirm-production) — nothing written.');
    console.log('Re-run with: node scripts/seed-demo-completed-exams.js --remote --confirm-production');
    return;
  }

  const questionsSnapshot = JSON.stringify(QUESTIONS.map((q, i) => ({ index: i, q: q.q, opts: q.opts, correct: q.correct })));

  const statements = rows.map((r) => {
    const answersJson = JSON.stringify(r.answers);
    const statisticsJson = JSON.stringify({ correctCount: r.correctCount, incorrectCount: QUESTIONS.length - r.correctCount });
    const submittedIso = r.submittedAt.toISOString();
    const dateField = submittedIso.slice(0, 10);
    return `INSERT INTO exam_attempts
      (employee_id, is_guest, first_name, last_name, employee_no, national_id, submission_token,
       email, date_field, lang, score, correct_count, passed,
       submitted_at, completed_at, pdf_status, is_demo,
       questions_snapshot, answers_json, statistics_json, created_at)
     VALUES
      (${r.employee.id}, 0, ${sqlEscape(r.employee.first_name)}, ${sqlEscape(r.employee.last_name)}, ${sqlEscape(r.employee.employee_no)}, ${sqlEscape(r.employee.national_id)}, ${sqlEscape(r.submissionToken)},
       ${sqlEscape('demo@example.com')}, ${sqlEscape(dateField)}, ${sqlEscape(r.lang)}, ${r.score}, ${r.correctCount}, ${r.passed ? 1 : 0},
       ${sqlEscape(submittedIso)}, ${sqlEscape(submittedIso)}, 'demo_not_generated', 1,
       ${sqlEscape(questionsSnapshot)}, ${sqlEscape(answersJson)}, ${sqlEscape(statisticsJson)}, ${sqlEscape(submittedIso)});`;
  });

  const tmpFile = path.join(os.tmpdir(), `seed-demo-attempts-${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, statements.join('\n'), 'utf8');

  console.log(`\nWriting ${rows.length} demo attempts to ${target}...`);
  runD1File(tmpFile, { remote });
  fs.unlinkSync(tmpFile);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
