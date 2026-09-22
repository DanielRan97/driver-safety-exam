// Sends the result email from the server via SMTP (nodemailer). Configure
// SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS (and optionally SMTP_FROM,
// SMTP_SECURE, MAIL_TO) as environment variables — see README.md.
const nodemailer = require('nodemailer');

const EMAIL_TO = process.env.MAIL_TO || 'efi@almogsea.co.il';

let transporter = null;
function getTransporter() {
  if (!transporter) {
    if (!process.env.SMTP_HOST) {
      throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in your environment.');
    }
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendResultEmail({ submission, pdfBuffer }) {
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

  const filename = `מבחן-בטיחות-${fullName || 'תוצאה'}.pdf`;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  console.log(`Sending result email for "${fullName}" — from: ${from} (logged in as SMTP_USER: ${process.env.SMTP_USER}) — to: ${EMAIL_TO}`);

  const info = await getTransporter().sendMail({
    from,
    to: EMAIL_TO,
    replyTo: email || undefined,
    subject,
    text,
    attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
  });

  console.log(`Email accepted by SMTP server. messageId: ${info.messageId} | response: ${info.response}`);
}

module.exports = { sendResultEmail, EMAIL_TO };
