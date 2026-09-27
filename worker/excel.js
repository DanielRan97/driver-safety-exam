// Builds the final campaign report as a real .xlsx file, using SheetJS —
// a pure-JS library (no fs dependency for writing), so it works in the
// Workers runtime the same way it would in a browser.
import * as XLSX from 'xlsx';

const HEADERS = [
  'שם פרטי', 'שם משפחה', 'מספר עובד', 'תעודת זהות',
  'ציון', 'עבר/נכשל', 'תאריך מבחן', 'שעת מבחן',
  'תשובות נכונות', 'תשובות שגויות',
];

function splitDateTime(isoString) {
  if (!isoString) return { date: '', time: '' };
  const d = new Date(isoString);
  return {
    date: d.toLocaleDateString('he-IL'),
    time: d.toLocaleTimeString('he-IL'),
  };
}

export function buildDriversExcelBase64(acceptedAttempts, totalQuestions) {
  const rows = acceptedAttempts.map((a) => {
    const { date, time } = splitDateTime(a.submitted_at || a.completed_at);
    return [
      a.first_name,
      a.last_name,
      a.employee_no || '',
      a.national_id,
      a.score,
      a.passed ? 'עבר' : 'נכשל',
      date,
      time,
      a.correct_count,
      totalQuestions - a.correct_count,
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  sheet['!cols'] = HEADERS.map(() => ({ wch: 16 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'נהגים נדרשים');

  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}
