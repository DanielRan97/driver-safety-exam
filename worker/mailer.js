// Sends the result email via the Resend HTTP API — identical approach to
// server/mailer.js (it was already just fetch() calls, no Node/SMTP APIs,
// so it needed no real porting). The only change: Workers don't use
// process.env, secrets/vars come through the `env` object passed into the
// fetch handler, so this takes `env` as a parameter instead of reading
// process.env directly.
const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendResultEmail(env, { submission, pdfBuffer }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured. Set it with `wrangler secret put RESEND_API_KEY`.');
  }
  const emailTo = env.MAIL_TO || 'efi@almogsea.co.il';

  const { first, last, id, empnum, date, score, passed, email } = submission;
  const fullName = `${first} ${last}`.trim();
  const subject = `תוצאת מבחן בטיחות - ${fullName} - ${date}`;
  const text = [
    'שלום,',
    '',
    'מצורפת תוצאת מבחן הבטיחות לנהג/ת טאג.',
    '',
    `שם מלא: ${fullName}`,
    `תעודת זהות: ${id}`,
    `מספר עובד: ${empnum}`,
    `תאריך: ${date}`,
    `אימייל הנהג/ת: ${email}`,
    `ציון: ${score} מתוך 100`,
    `סטטוס: ${passed ? 'עבר/ה את המבחן' : 'לא עבר/ה את המבחן'}`,
    '',
    'הקובץ המצורף כולל את כל 20 השאלות עם התשובה שנבחרה מול התשובה הנכונה.',
    '',
    'הודעה זו נשלחה אוטומטית ממערכת המבחן.',
  ].join('\n');

  // Attachment filenames must stay ASCII — a Hebrew filename in the
  // Content-Disposition header broke the attachment entirely in Gmail.
  const filenameSafeId = String(empnum || id || 'result').replace(/[^A-Za-z0-9-]/g, '');
  const filename = `driver-safety-exam-${filenameSafeId}-${date || ''}.pdf`.replace(/[^A-Za-z0-9._-]/g, '-');
  const from = env.RESEND_FROM || 'Driver Safety Exam <onboarding@resend.dev>';

  console.log(`Sending result email for "${fullName}" — from: ${from} — to: ${emailTo}`);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [emailTo],
      reply_to: email || undefined,
      subject,
      text,
      attachments: [{ filename, content: Buffer.from(pdfBuffer).toString('base64') }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${body.message || JSON.stringify(body)}`);
  }

  console.log(`Email accepted by Resend. id: ${body.id}`);
}
