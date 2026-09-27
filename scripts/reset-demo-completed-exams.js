// Removes ONLY the temporary demo exam attempts created by
// scripts/seed-demo-completed-exams.js — identified precisely by
// is_demo=1 (migrations/0004_demo_marker.sql), never by name, date, or
// any other heuristic. Real attempts, employees, testers, guests, and
// admin accounts/sessions/passwords are never touched, and no D1 schema
// or R2 bucket configuration is changed.
//
// Usage:
//   node scripts/reset-demo-completed-exams.js --local
//   node scripts/reset-demo-completed-exams.js --remote --confirm-production
//   node scripts/reset-demo-completed-exams.js --remote          (preview only, refuses to delete)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runD1Command, runD1File, deleteR2Object } = require('./lib/wrangler-exec');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const confirmed = args.includes('--confirm-production');
const target = remote ? '--remote' : '--local';
const dryRun = remote && !confirmed;

function main() {
  console.log(`Looking up demo attempts (is_demo=1) on ${target}...`);
  const demoRows = runD1Command(
    'SELECT id, employee_id, first_name, last_name, employee_no, score, passed, lang, submitted_at, pdf_status, pdf_r2_key FROM exam_attempts WHERE is_demo=1 ORDER BY id',
    { remote },
  );

  if (demoRows.length === 0) {
    console.log('No demo attempts found (is_demo=1) — nothing to reset.');
    return;
  }

  console.log(`\nThe following ${demoRows.length} demo attempt(s) will be DELETED:`);
  console.log('id   employee_no  name                      score  lang  pdf_r2_key');
  demoRows.forEach((r) => {
    console.log(`${String(r.id).padEnd(4)} ${(r.employee_no || '').padEnd(12)} ${`${r.first_name} ${r.last_name}`.padEnd(25)} ${String(r.score).padStart(3)}    ${r.lang}    ${r.pdf_r2_key || '(none)'}`);
  });

  const pdfKeys = demoRows.filter((r) => r.pdf_r2_key).map((r) => r.pdf_r2_key);
  if (pdfKeys.length) {
    console.log(`\n${pdfKeys.length} demo PDF object(s) in R2 will also be deleted:`);
    pdfKeys.forEach((k) => console.log(`  ${k}`));
  } else {
    console.log('\nNo demo PDF objects in R2 to delete.');
  }

  console.log('\nNothing else will be touched: employees, admin_users, admin_sessions, testers, guests, and non-demo attempts are not in scope for this delete.');

  if (dryRun) {
    console.log('\nDry run only (remote without --confirm-production) — nothing deleted.');
    console.log('Re-run with: node scripts/reset-demo-completed-exams.js --remote --confirm-production');
    return;
  }

  pdfKeys.forEach((key) => {
    try {
      deleteR2Object(key, { remote });
    } catch (err) {
      console.error(`Warning: failed to delete R2 object ${key}: ${err.message}`);
    }
  });

  const ids = demoRows.map((r) => r.id).join(',');
  const sql = `DELETE FROM exam_attempts WHERE is_demo=1 AND id IN (${ids});`;
  const tmpFile = path.join(os.tmpdir(), `reset-demo-attempts-${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, sql, 'utf8');

  console.log(`\nDeleting ${demoRows.length} demo attempt(s) from ${target}...`);
  runD1File(tmpFile, { remote });
  fs.unlinkSync(tmpFile);
  console.log('Done. Real employees, testers, guests, admin accounts, and non-demo attempts were not touched.');
}

main();
