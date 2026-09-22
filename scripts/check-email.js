// Standalone Resend connectivity check — run with `npm run check-email`.
// Sends a tiny test email using the configured RESEND_API_KEY, without
// going through the whole exam UI each time you're debugging credentials.
require('dotenv').config();

const apiKey = process.env.RESEND_API_KEY;
const to = process.env.MAIL_TO || 'efi@almogsea.co.il';
const from = process.env.RESEND_FROM || 'Driver Safety Exam <onboarding@resend.dev>';

console.log('--- Resend config being tested ---');
console.log('RESEND_API_KEY:', apiKey ? `set (${apiKey.length} chars)` : '(missing)');
console.log('from          :', from);
console.log('to            :', to);
console.log('-----------------------------------');

if (!apiKey) {
  console.error('\nMissing RESEND_API_KEY — get one at https://resend.com/api-keys and add it to .env');
  process.exit(1);
}

fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from,
    to: [to],
    subject: 'Driver safety exam — test email',
    text: 'This is a test email from scripts/check-email.js.',
  }),
})
  .then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`\nFAILED (${res.status}):`, body.message || JSON.stringify(body));
      process.exit(1);
    }
    console.log('\nSUCCESS: email accepted by Resend. id:', body.id);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
  });
