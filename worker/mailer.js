// Sends emails via the Resend HTTP API. Same approach as before (already
// just fetch() calls, no Node/SMTP APIs) — extended with the required-
// driver completion progress line and the automatic final campaign report.
const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendViaResend(env, { subject, text, attachments, replyTo }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured. Set it with `wrangler secret put RESEND_API_KEY`.');
  }
  const emailTo = env.MAIL_TO || 'efi@almogsea.co.il';
  const from = env.RESEND_FROM || 'Driver Safety Exam <onboarding@resend.dev>';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [emailTo],
      reply_to: replyTo || undefined,
      subject,
      text,
      attachments,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${body.message || JSON.stringify(body)}`);
  }
  return body;
}

// `progress`, when given (only for required drivers — not guests/testers),
// is { completed, total } and gets appended to the email body.
export async function sendResultEmail(env, { submission, pdfBuffer, progress, isGuest, isTester }) {
  const { first, last, id, empnum, date, score, passed, email } = submission;
  const fullName = `${first} ${last}`.trim();
  const subject = `תוצאת מבחן בטיחות - ${fullName} - ${date}`;

  const lines = [
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
  ];

  if (isTester) {
    lines.push('', '(בדיקה — Tester, לא נספר בסטטיסטיקות ובדוח הסופי)');
  } else if (isGuest) {
    lines.push('', '(אורח/ת — לא ברשימת הנהגים הנדרשים, לא נספר בסטטיסטיקות ובדוח הסופי)');
  } else if (progress) {
    const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 1000) / 10 : 0;
    lines.push('', `התקדמות השלמת נהגים: ${progress.completed} / ${progress.total} (${pct}%)`);
  }

  lines.push(
    '',
    'הקובץ המצורף כולל את כל 20 השאלות עם התשובה שנבחרה מול התשובה הנכונה.',
    '',
    'הודעה זו נשלחה אוטומטית ממערכת המבחן.',
  );

  // Attachment filenames must stay ASCII — a Hebrew filename in the
  // Content-Disposition header broke the attachment entirely in Gmail.
  const filenameSafeId = String(empnum || id || 'result').replace(/[^A-Za-z0-9-]/g, '');
  const filename = `driver-safety-exam-${filenameSafeId}-${date || ''}.pdf`.replace(/[^A-Za-z0-9._-]/g, '-');

  console.log(`Sending result email for empnum ${empnum || '(guest)'} — score ${score}`);

  const body = await sendViaResend(env, {
    subject,
    text: lines.join('\n'),
    replyTo: email,
    attachments: [{ filename, content: Buffer.from(pdfBuffer).toString('base64') }],
  });

  console.log(`Email accepted by Resend. id: ${body.id}`);
}

export async function sendFinalReportEmail(env, { excelBase64, stats }) {
  const subject = `דוח סופי – השלמת מבחן בטיחות לכל הנהגים הנדרשים (${stats.totalCompleted}/${stats.totalCompleted})`;

  const top = (list) => list.map((q, i) => `  ${i + 1}. "${q.text.slice(0, 60)}${q.text.length > 60 ? '…' : ''}" — ${q.missedCount} טעויות (${q.missedPercent}%)`).join('\n');

  const text = [
    'שלום,',
    '',
    'כל הנהגים הנדרשים השלימו את מבחן הבטיחות. מצורף דוח Excel מלא, וסיכום סטטיסטי:',
    '',
    `סה"כ נהגים נדרשים שהשלימו: ${stats.totalCompleted}`,
    `ציון ממוצע: ${stats.averageScore}`,
    `ציון חציוני: ${stats.medianScore}`,
    `ציון גבוה ביותר: ${stats.highestScore}`,
    `ציון נמוך ביותר: ${stats.lowestScore}`,
    `עברו: ${stats.passedCount} (${stats.passPercent}%)`,
    `נכשלו: ${stats.failedCount}`,
    `ציון מושלם (100): ${stats.perfectScoreCount} נהגים`,
    `ממוצע תשובות שגויות לנהג: ${stats.averageIncorrectAnswers}`,
    '',
    'השאלות עם הכי הרבה טעויות:',
    top(stats.mostMissedQuestions),
    '',
    'השאלות שנענו הכי הרבה נכון:',
    top(stats.mostCorrectlyAnsweredQuestions),
    '',
    'הודעה זו נשלחה אוטומטית ממערכת המבחן, פעם אחת בלבד עם השלמת כל הנהגים הנדרשים.',
  ].join('\n');

  console.log(`Sending final campaign report — ${stats.totalCompleted} drivers`);

  const body = await sendViaResend(env, {
    subject,
    text,
    attachments: [{ filename: 'driver-safety-exam-final-report.xlsx', content: excelBase64 }],
  });

  console.log(`Final report email accepted by Resend. id: ${body.id}`);
}
