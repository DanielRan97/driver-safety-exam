// Server-side PDF generation with Puppeteer (real Chromium rendering the
// exact same markup/CSS as the old client-side #printable block), so the
// emailed PDF never depends on the driver's browser or html2canvas.
const puppeteer = require('puppeteer');

const PRINTABLE_CSS = `
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Heebo', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;color:#16212C;direction:rtl;background:#fff;}
  .p-header{background:#0A1826;color:#fff;padding:26px 34px;border-bottom:6px solid #FFC63C;}
  .p-header h2{margin:0 0 4px;font-size:22px;}
  .p-header p{margin:0;color:#B9C6D3;font-size:13px;}
  .p-details{padding:20px 34px;border-bottom:1px solid #E3E7EA;}
  .p-details table{width:100%;border-collapse:collapse;font-size:13px;}
  .p-details td{padding:4px 0;}
  .p-details td.k{color:#64707C;width:130px;}
  .p-details td.v{font-weight:700;}
  .p-score{padding:18px 34px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #E3E7EA;}
  .p-score .num{font-size:34px;font-weight:800;}
  .p-score .num.pass{color:#2E7D4F;}
  .p-score .num.fail{color:#C6432A;}
  .p-score .lbl{font-size:14px;font-weight:700;}
  .p-q{padding:14px 34px;border-bottom:1px solid #EEF1F2;}
  .p-q .qn{font-size:12px;font-weight:800;background:#FFC63C;color:#0A1826;border-radius:5px;padding:1px 7px;display:inline-block;margin-bottom:6px;}
  .p-q .qt{font-size:13.5px;font-weight:600;margin-bottom:8px;line-height:1.5;}
  .p-q .oa{font-size:12.5px;padding:5px 10px;border-radius:6px;margin-bottom:4px;border:1px solid #E3E7EA;}
  .p-q .oa.correct{background:#E9F3EC;border-color:#2E7D4F;color:#2E7D4F;font-weight:700;}
  .p-q .oa.wrong{background:#FBEAE6;border-color:#C6432A;color:#C6432A;font-weight:700;}
  .p-foot{padding:16px 34px;font-size:11px;color:#8993A0;}
`;

const HE_LETTERS = ['א', 'ב', 'ג', 'ד'];
const LANG_NAMES = { en: 'אנגלית', ar: 'ערבית', ru: 'רוסית', zh: 'סינית', pt: 'פורטוגזית' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml({ submission, questions }) {
  const { first, last, email, id, empnum, date, lang, answers, correct, score, passed } = submission;

  let qHtml = '';
  questions.forEach((item, qi) => {
    const chosen = answers[qi];
    let optsHtml = '';
    item.opts.forEach((optText, oi) => {
      let cls = '';
      if (oi === item.correct) cls = 'correct';
      else if (oi === chosen) cls = 'wrong';
      if (cls) {
        optsHtml += `<div class="oa ${cls}">${HE_LETTERS[oi]}. ${esc(optText)}${oi === item.correct ? '  ✓ תשובה נכונה' : '  ✗ נבחרה'}</div>`;
      }
    });
    qHtml += `<div class="p-q"><div class="qn">שאלה ${qi + 1}</div><div class="qt">${esc(item.q)}</div>${optsHtml}</div>`;
  });

  let langNote = '';
  if (lang && lang !== 'he') {
    langNote = ' · המבחן בוצע בשפה: ' + (LANG_NAMES[lang] || lang);
  }

  const now = new Date();

  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${PRINTABLE_CSS}</style></head><body>
<div class="p-header"><h2>מבחן בטיחות – נהגי טאג</h2><p>מסוף מכולות · דוח תוצאה אישי</p></div>
<div class="p-details"><table>
  <tr><td class="k">שם מלא</td><td class="v">${esc(first)} ${esc(last)}</td><td class="k">תאריך</td><td class="v">${esc(date)}</td></tr>
  <tr><td class="k">תעודת זהות</td><td class="v">${esc(id)}</td><td class="k">מספר עובד</td><td class="v">${esc(empnum)}</td></tr>
  <tr><td class="k">אימייל</td><td class="v" style="direction:ltr;text-align:right;">${esc(email)}</td><td></td><td></td></tr>
</table></div>
<div class="p-score">
  <div class="num ${passed ? 'pass' : 'fail'}">${score}</div>
  <div><div class="lbl">${passed ? 'עבר/ה את המבחן' : 'לא עבר/ה את המבחן'}</div>
  <div style="font-size:12px;color:#64707C;">${correct} תשובות נכונות מתוך ${questions.length} · ציון עובר: 100</div></div>
</div>
${qHtml}
<div class="p-foot">הופק אוטומטית בתאריך ${now.toLocaleDateString('he-IL')} בשעה ${now.toLocaleTimeString('he-IL')}${langNote}</div>
</body></html>`;
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

async function buildResultPdf({ submission, questions }) {
  const html = buildHtml({ submission, questions });
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

module.exports = { buildResultPdf, closeBrowser };
