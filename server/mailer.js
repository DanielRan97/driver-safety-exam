// Sends the result email via the Resend HTTP API (https://resend.com).
// We use an HTTP API instead of raw SMTP because several free-tier hosts
// (Render's free plan among them) block outbound SMTP connections
// entirely — HTTPS calls like this one are unaffected.
// Configure RESEND_API_KEY (and optionally RESEND_FROM, MAIL_TO) as
// environment variables — see README.md.
const EMAIL_TO = process.env.MAIL_TO || 'efi@almogsea.co.il';
const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendResultEmail({ submission, pdfBuffer }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured. Set it in your environment.');
  }

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
  // Content-Disposition header broke the attachment entirely in Gmail
  // (garbled name, file wouldn't even open). The PDF's *content* is still
  // full Hebrew as always; only the filename itself is Latin/ASCII.
  const filenameSafeId = String(empnum || id || 'result').replace(/[^A-Za-z0-9-]/g, '');
  const filename = `driver-safety-exam-${filenameSafeId}-${date || ''}.pdf`.replace(/[^A-Za-z0-9._-]/g, '-');
  const from = process.env.RESEND_FROM || 'Driver Safety Exam <onboarding@resend.dev>';

  console.log(`Sending result email for "${fullName}" — from: ${from} — to: ${EMAIL_TO}`);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [EMAIL_TO],
      reply_to: email || undefined,
      subject,
      text,
      attachments: [{ filename, content: pdfBuffer.toString('base64') }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${body.message || JSON.stringify(body)}`);
  }

  console.log(`Email accepted by Resend. id: ${body.id}`);
}

module.exports = { sendResultEmail, EMAIL_TO };
