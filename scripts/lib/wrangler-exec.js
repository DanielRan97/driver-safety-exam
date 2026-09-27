// Shared helpers for scripts that shell out to `wrangler d1` against the
// production/local database — used by scripts/seed-demo-completed-exams.js
// and scripts/reset-demo-completed-exams.js so both talk to D1 the same
// way and can't drift apart on quoting/parsing.
const { execFileSync } = require('child_process');
const path = require('path');

// Invoke wrangler's own JS entry point directly with `node`, rather than
// shelling out through `npx`/`npx.cmd` — spawning the Windows .cmd shim
// via execFileSync without a shell throws EINVAL, and adding a shell
// reopens quoting hazards for the SQL text these scripts pass through.
const WRANGLER_BIN = path.join(__dirname, '..', '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'driver-safety-exam-db';
const PDF_BUCKET = 'driver-safety-exam-pdfs';

function runWrangler(args, opts = {}) {
  return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
    ...opts,
  });
}

function runD1Command(sql, { remote }) {
  const out = runWrangler(['d1', 'execute', DB_NAME, remote ? '--remote' : '--local', '--json', '--command', sql]);
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

function runD1File(filePath, { remote }) {
  runWrangler(['d1', 'execute', DB_NAME, remote ? '--remote' : '--local', '-y', '--file', filePath], { stdio: 'inherit' });
}

function deleteR2Object(key, { remote }) {
  runWrangler(['r2', 'object', 'delete', `${PDF_BUCKET}/${key}`, remote ? '--remote' : '--local', '-y'], { stdio: 'inherit' });
}

function sqlEscape(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

module.exports = { runD1Command, runD1File, deleteR2Object, sqlEscape, DB_NAME, PDF_BUCKET };
