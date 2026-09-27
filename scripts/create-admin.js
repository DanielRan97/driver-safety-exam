// Creates (or resets the password for) an admin account, without ever
// putting a plaintext password in source control. Run locally:
//
//   node scripts/create-admin.js <username> <display-name>
//
// It generates a random password, hashes it (same PBKDF2-SHA256 scheme
// the Worker verifies against — Node's crypto.pbkdf2 and the Worker's
// Web Crypto deriveBits produce identical output for the same inputs),
// and prints the exact `wrangler d1 execute` command to run — you paste
// that into your OWN terminal (never captured/logged by this script), so
// the password is never written to a file or committed anywhere.
const crypto = require('crypto');

const PBKDF2_ITERATIONS = 150000;

function randomPassword(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

const [, , username, ...nameParts] = process.argv;
if (!username) {
  console.error('Usage: node scripts/create-admin.js <username> <display-name>');
  console.error('Example: node scripts/create-admin.js daniel "Daniel Ran"');
  process.exit(1);
}
const displayName = nameParts.join(' ') || username;
const password = randomPassword();
const { hash, salt } = hashPassword(password);

console.log('\n=== Admin account: ' + username + ' ===');
console.log('Generated password (save it somewhere safe — shown only once here):');
console.log('  ' + password);
console.log('\nRun this locally to create/update the account (DB name: driver-safety-exam-db):\n');

const sql = `INSERT INTO admin_users (username, display_name, password_hash, password_salt, role, is_active, created_at)
VALUES ('${username}', '${displayName.replace(/'/g, "''")}', '${hash}', '${salt}', 'admin', 1, CURRENT_TIMESTAMP)
ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, password_salt=excluded.password_salt, display_name=excluded.display_name, is_active=1;`;

console.log(`npx wrangler d1 execute driver-safety-exam-db --remote --command "${sql.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`);
console.log('\n(Add --local instead of --remote to set it up for local dev/testing only.)\n');
