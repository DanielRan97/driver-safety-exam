// Resets the exam campaign to a completely clean starting state: deletes
// EVERY row in exam_attempts (real, guest, tester, and demo attempts
// alike — this is a full reset, unlike reset-demo-completed-exams.js
// which only removes is_demo=1 rows), deletes any associated R2 PDF
// objects, clears employees.can_do_again for everyone, and resets the
// old campaign_state report gate.
//
// Never touches: employees rows themselves (not deleted), admin_users,
// admin_sessions, admin_login_attempts, D1 schema/migrations, the R2
// bucket itself (only objects inside it), or any Worker configuration.
//
// Usage:
//   node scripts/reset-campaign-full.js --local
//   node scripts/reset-campaign-full.js --remote --confirm-production
//   node scripts/reset-campaign-full.js --remote          (preview only, refuses to delete)
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
  console.log(`Reading current campaign state (${target})...`);

  const [{ n: totalAttempts }] = runD1Command('SELECT COUNT(*) AS n FROM exam_attempts', { remote });
  const guestBreakdown = runD1Command('SELECT is_guest, COUNT(*) AS n FROM exam_attempts GROUP BY is_guest', { remote });
  const demoBreakdown = runD1Command('SELECT is_demo, COUNT(*) AS n FROM exam_attempts GROUP BY is_demo', { remote });
  const [{ n: completedRequired }] = runD1Command(
    `SELECT COUNT(DISTINCT a.employee_id) AS n FROM exam_attempts a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.is_guest = 0 AND e.role='driver' AND e.is_required = 1`,
    { remote },
  );
  const pdfRows = runD1Command("SELECT id, pdf_r2_key FROM exam_attempts WHERE pdf_r2_key IS NOT NULL", { remote });
  const [{ n: requiredDrivers }] = runD1Command(
    "SELECT COUNT(*) AS n FROM employees WHERE role='driver' AND is_required=1 AND is_active=1",
    { remote },
  );

  console.log(`\nCurrent state (${target}):`);
  console.log(`  Total exam_attempts rows: ${totalAttempts}`);
  console.log(`  By is_guest: ${JSON.stringify(guestBreakdown)}`);
  console.log(`  By is_demo:  ${JSON.stringify(demoBreakdown)}`);
  console.log(`  Required drivers: ${requiredDrivers}`);
  console.log(`  Completed required drivers: ${completedRequired}`);
  console.log(`  Stored R2 PDF objects to delete: ${pdfRows.length}`);
  if (pdfRows.length) pdfRows.forEach((r) => console.log(`    exam_attempts.id=${r.id} -> ${r.pdf_r2_key}`));

  console.log('\nThis reset WILL:');
  console.log(`  - DELETE ALL ${totalAttempts} row(s) from exam_attempts (real, guest, tester, and demo alike)`);
  console.log(`  - Delete ${pdfRows.length} R2 PDF object(s) listed above`);
  console.log('  - Set can_do_again = 0 for every employee');
  console.log('  - Reset campaign_state.report_sent_at to NULL');
  console.log('\nThis reset will NOT touch: employees rows (kept), admin_users, admin_sessions, admin_login_attempts, D1 schema/migrations, the R2 bucket itself, or Worker configuration.');

  if (dryRun) {
    console.log('\nDry run only (remote without --confirm-production) — nothing deleted.');
    console.log('Re-run with: node scripts/reset-campaign-full.js --remote --confirm-production');
    return;
  }

  if (pdfRows.length) {
    console.log(`\nDeleting ${pdfRows.length} R2 PDF object(s)...`);
    pdfRows.forEach((r) => {
      try {
        deleteR2Object(r.pdf_r2_key, { remote });
      } catch (err) {
        console.error(`Warning: failed to delete R2 object ${r.pdf_r2_key}: ${err.message}`);
      }
    });
  }

  const sql = [
    'DELETE FROM exam_attempts;',
    'UPDATE employees SET can_do_again = 0;',
    "UPDATE campaign_state SET report_sent_at = NULL WHERE id = 1;",
  ].join('\n');
  const tmpFile = path.join(os.tmpdir(), `reset-campaign-${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, sql, 'utf8');

  console.log(`\nApplying full reset to ${target}...`);
  runD1File(tmpFile, { remote });
  fs.unlinkSync(tmpFile);

  console.log('\nVerifying final state...');
  const [{ n: finalAttempts }] = runD1Command('SELECT COUNT(*) AS n FROM exam_attempts', { remote });
  const [{ n: finalRequired }] = runD1Command(
    "SELECT COUNT(*) AS n FROM employees WHERE role='driver' AND is_required=1 AND is_active=1",
    { remote },
  );
  const [{ n: finalCompleted }] = runD1Command(
    `SELECT COUNT(DISTINCT a.employee_id) AS n FROM exam_attempts a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.is_guest = 0 AND e.role='driver' AND e.is_required = 1`,
    { remote },
  );
  console.log(`  exam_attempts total: ${finalAttempts}`);
  console.log(`  required drivers: ${finalRequired}`);
  console.log(`  completed required drivers: ${finalCompleted}`);
  console.log('\nDone. Real employees, admin_users, admin_sessions, D1 schema, and the R2 bucket were not touched.');
}

main();
