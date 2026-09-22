// Standalone SMTP connectivity check — run with `npm run check-smtp`.
// Verifies the SMTP_* env vars can actually authenticate, without going
// through the whole exam UI each time you're debugging credentials.
require('dotenv').config();
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS || '';

console.log('--- SMTP config being tested ---');
console.log('SMTP_HOST  :', host || '(missing)');
console.log('SMTP_PORT  :', port);
console.log('SMTP_SECURE:', secure);
console.log('SMTP_USER  :', user || '(missing)');
console.log('SMTP_PASS  : length =', pass.length, pass.includes(' ') ? '(!!! contains a space — that is almost always the bug, see below)' : '(no spaces)');
console.log('--------------------------------');

if (!host || !user || !pass) {
  console.error('\nMissing SMTP_HOST / SMTP_USER / SMTP_PASS — fill them in .env first.');
  process.exit(1);
}
if (pass.includes(' ')) {
  console.error('\nSMTP_PASS contains a space. A Gmail App Password is 16 characters with NO');
  console.error('spaces — Google only displays it grouped in 4s for readability. Remove all');
  console.error('spaces (or wrap the value in quotes in .env) and try again.');
}

const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

transporter.verify()
  .then(() => {
    console.log('\nSUCCESS: logged in to the SMTP server correctly.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
  });
