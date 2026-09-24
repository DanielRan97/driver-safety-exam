// Server-side PDF generation for the Cloudflare Worker, using Cloudflare
// Browser Run (@cloudflare/puppeteer) instead of local Puppeteer+Chromium —
// Workers can't spawn a real browser process themselves, but the `browser`
// binding gives us a remote, Puppeteer-compatible one. The HTML/CSS being
// rendered is unchanged from server/pdf.js (same markup, same embedded
// Heebo font, same layout) — only how the browser is launched differs.
import puppeteer from '@cloudflare/puppeteer';
import fonts from './generated/fonts.json';

const FONT_FACE_CSS = `
  @font-face{
    font-family:'Heebo';
    font-style:normal;
    font-weight:100 900;
    src:url(data:font/woff2;base64,${fonts.hebrew}) format('woff2');
    unicode-range:U+0307-0308,U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F;
  }
  @font-face{
    font-family:'Heebo';
    font-style:normal;
    font-weight:100 900;
    src:url(data:font/woff2;base64,${fonts.latin}) format('woff2');
    unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122;
  }
`;

const PRINTABLE_CSS = `
  ${FONT_FACE_CSS}
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Heebo', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;color:#16212C;direction:rtl;background:#fff;}
  .p-header{background:linear-gradient(90deg,#1E0080,#1450E0 55%,#10A5FD);color:#fff;padding:26px 34px;}
  .p-header h2{margin:0 0 4px;font-size:22px;}
  .p-header p{margin:0;color:rgba(255,255,255,.8);font-size:13px;}
  .p-details{padding:20px 34px;border-bottom:1px solid #E3E7EA;}
  .p-details table{width:100%;border-collapse:collapse;font-size:13px;}
  .p-details td{padding:4px 0;}
  .p-details td.k{color:#64707C;width:130px;}
  .p-details td.v{font-weight:700;}
  .p-score{padding:18px 34px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #E3E7EA;}
  .p-score .num{font-size:34px;font-weight:800;}
  .p-score .num.pass{color:#1E0080;}
  .p-score .num.fail{color:#C6432A;}
  .p-score .lbl{font-size:14px;font-weight:700;}
  .p-q{padding:14px 34px;border-bottom:1px solid #EEF1F2;}
  .p-q .qn{font-size:12px;font-weight:800;background:#EEF2FF;color:#1E0080;border-radius:5px;padding:1px 7px;display:inline-block;margin-bottom:6px;}
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

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    Promise.resolve(promise).then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); },
    );
  });
}

// One browser session per request — free-tier Browser Run allows a new
// session every 20s and 3 concurrent, which comfortably covers occasional
// driver submissions without the added complexity of pooling sessions
// across requests (which would need Durable Objects to coordinate).
export async function buildResultPdf(env, { submission, questions }) {
  const html = buildHtml({ submission, questions });
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await withTimeout(page.evaluate(() => document.fonts.ready), 8000);
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
