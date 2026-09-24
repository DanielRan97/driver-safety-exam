# מבחן בטיחות – נהגי טאג (Frontend + Backend)

האתר עבר משדרוג מקובץ HTML בודד לאפליקציית Node.js/Express מלאה. ברגע שנהג לוחץ
"סיום המבחן" ורואה את התוצאה, האתר שולח אוטומטית בקשה לשרת, שמחשב מחדש את
הציון (לא סומך על הדפדפן), בונה PDF בעברית עם Puppeteer, ושולח אותו במייל
ל-`efi@almogsea.co.il` — בלי שום פעולה נוספת מצד הנהג. הורדת ה-PDF וכפתור
ה-mailto הישנים עדיין קיימים כאופציה נוספת/גיבוי ידני.

**בתהליך מעבר מ-Render ל-Cloudflare Workers** (כדי להיפטר מ"התעוררות" השרת
אחרי חוסר פעילות) — ראו [CLOUDFLARE.md](CLOUDFLARE.md) למדריך הפריסה המלא.
המדריך הזה (README.md) עדיין מתאר את ההרצה/פריסה ב-Render, ששניהם עובדים
במקביל עד שה-Cloudflare מאומת ב-100%.

## מבנה הפרויקט

```
public/index.html    — הפרונטאנד (העיצוב במיתוג ALMOG Logistics Group + שליחה אוטומטית לשרת)
public/assets/        — לוגו ALMOG (almog-logo.png, almog-icon.png)

--- גרסת Render (Express, עדיין פעילה) ---
server/index.js      — Express app + endpoint POST /api/submit
server/questions.js  — קורא את מאגר השאלות (QUESTIONS_HE) ישירות מתוך public/index.html,
                        כך שאין כפילות/סטייה אפשרית בין הלקוח לשרת
server/pdf.js         — בונה את ה-PDF בצד השרת עם Puppeteer (מדפיס HTML אמיתי, לא צילום מסך)
server/mailer.js      — שולח את המייל דרך Resend (HTTP API, לא SMTP)
server/storage.js     — לוג גיבוי מצטבר ל-data/submissions.csv
data/                  — נוצר אוטומטית, לא נכנס ל-git (מכיל מידע אישי על נהגים)

--- גרסת Cloudflare Workers (ראו CLOUDFLARE.md) ---
worker/index.js        — ה-Worker: routing + POST /api/submit
worker/pdf.js           — בונה את ה-PDF עם Cloudflare Browser Run (@cloudflare/puppeteer)
worker/mailer.js        — זהה בעיקרון ל-server/mailer.js, מקבל env במקום process.env
worker/storage.js       — גיבוי הגשות ל-Cloudflare KV במקום CSV
worker/generated/       — נוצר אוטומטית ע"י scripts/build-worker-data.js, לא נכנס ל-git
scripts/build-worker-data.js — שלב build: מייצא את מאגר השאלות + הגופנים לתוך worker/generated/
wrangler.jsonc          — קונפיגורציית הפריסה ל-Cloudflare
```

מאגר השאלות, התרגומים ללשונות, לוגיקת הניקוד וה-UI **לא שונו** — רק נוספה שכבת
תקשורת לשרת.

## 1. הרצה מקומית לבדיקה

```bash
npm install
cp .env.example .env
```

ערוך/י את `.env` ומלא/י `RESEND_API_KEY` אמיתי (ראו סעיף 3 למטה). ואז:

```bash
npm start
```

השרת יעלה על `http://localhost:3000`. פתחו את הכתובת בדפדפן — זה בדיוק אותו
מסך המבחן כמו קודם. מלאו את הטופס, ענו על 20 השאלות ולחצו "סיום המבחן": תוך
כמה שניות אמור להישלח מייל אוטומטית ל-`efi@almogsea.co.il` עם ה-PDF מצורף,
ומתחת לציון יופיע סטטוס ("שולח את התוצאה..." → "התוצאה נשלחה בהצלחה במייל").

אם אין `.env`/`RESEND_API_KEY` מוגדר, השליחה תיכשל בכוונה (עם הודעת שגיאה ברורה
בלוג השרת), אבל שורת הגיבוי עדיין תישמר ב-`data/submissions.csv` והנהג יראה
הודעת שגיאה עם אפשרות להוריד את ה-PDF ולשלוח ידנית.

## 2. פריסה (Deploy) — מומלץ: Render

Puppeteer צריך תהליך Node "רגיל" (לא serverless) עם דיסק זמין להורדת
Chromium בזמן ה-build, ולכן **Render (Web Service)** או **Railway** מתאימים
טוב יותר מ-Vercel Functions לפרויקט הזה.

### Render (הכי פשוט)
1. דחפו את הפרויקט ל-GitHub (בלי `.env` — הוא ב-`.gitignore`).
2. ב-Render: New → Web Service → חברו את ה-repo.
3. **Build Command**: `npm install && npx puppeteer browsers install chrome`
   (לא סתם `npm install` — אחרת Puppeteer עלול "לאבד" את Chrome בין שלב ה-build
   לשלב ה-runtime, וגם קאש build ישן עלול לדלג על הורדת הדפדפן).
4. **Start Command**: `npm start`
5. תחת **Environment**, הוסיפו את המשתנים האלה (כל אחד כשורה נפרדת, KEY ו-VALUE —
   לא הכל בשדה אחד):
   - כל משתני ה-Resend מסעיף 3 למטה (`RESEND_API_KEY` וכו').
   - `PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer`
     (מכריח את Puppeteer לשמור את Chrome בתוך תיקיית הפרויקט, כדי שהוא יעבור
     נכון מ-build ל-runtime).
6. **חשוב**: אחרי הוספת/שינוי משתני סביבה, תמיד ודאו שנשמרו בפועל (לחצו Save,
   ורעננו את הדף כדי לוודא שהם עדיין שם) לפני שעושים deploy.
7. (מומלץ) הוסיפו Persistent Disk קטן (1GB מספיק) ומחוברת לנתיב `/opt/render/project/src/data`
   אם חשוב לכם ש-`submissions.csv` ישרוד בין דיפלוימנטים. בלי דיסק קבוע,
   הקובץ עדיין נכתב אבל עלול להימחק בדיפלוי הבא — זה בסדר, כי הוא רק גיבוי;
   המייל הוא הערוץ הראשי.
8. Deploy. הכתובת הציבורית שתקבלו היא בדיוק מה ששולחים לנהגים.

**שים לב (Free tier)**: שירות חינמי ב-Render "נרדם" אחרי חוסר פעילות, וה-בקשה
הראשונה אחרי שינה יכולה לקחת 50+ שניות. זה תקין — לא תקלה.

### Railway (חלופה טובה באותה מידה)
זהה בעיקרון: New Project → Deploy from GitHub → הוסיפו את משתני הסביבה →
Railway מזהה `npm start` אוטומטית. אם תרצו שהגיבוי ב-CSV ישרוד, הוסיפו Volume
ומפו אותו לתיקיית `data/`.

## 3. משתני סביבה נדרשים (Resend)

**למה לא SMTP רגיל (Gmail וכו')?** ניסינו את זה קודם וזה עבד מקומית, אבל
נכשל תמיד מ-Render עם `ETIMEDOUT` — **תוכניות החינם של Render (ושל כמה
פלטפורמות דומות) חוסמות חיבורי SMTP יוצאים לגמרי**, כמדיניות אנטי-ספאם. זו
לא תקלה שניתן לתקן בצד שלנו. הפתרון: לשלוח מייל דרך API מבוסס HTTP (פורט
443 רגיל, לא חסום) במקום SMTP גולמי. Resend הוא כזה, עם רמה חינמית נדיבה.

1. הירשמו בחינם ב-[resend.com](https://resend.com) (בלי כרטיס אשראי).
2. צרו API key ב-[resend.com/api-keys](https://resend.com/api-keys).
3. הדביקו אותו ל-`.env`:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
```

| משתנה | הסבר |
|---|---|
| `RESEND_API_KEY` | המפתח מ-resend.com/api-keys — חובה |
| `RESEND_FROM` | (אופציונלי) כתובת "מאת". בלי דומיין מאומת ב-Resend, אפשר לשלוח רק מ-`onboarding@resend.dev` (ברירת המחדל) — זה עובד מצוין לשליחה עצמה, רק הכתובת שתופיע כ"שולח" תהיה זו, לא `daniel@almogsea.co.il`. |
| `MAIL_TO` | (אופציונלי) לשינוי כתובת היעד; ברירת המחדל היא `efi@almogsea.co.il` |
| `PORT` | פורט השרת (ברירת מחדל 3000; ב-Render/Railway מוגדר אוטומטית) |

**המצב בפועל היום**: חשבון ה-Resend רשום עם `efi@almogsea.co.il` עצמו (לא דומיין
מאומת) — ב-Sandbox של Resend זה מאפשר לשלוח בדיוק לכתובת שנרשמת איתה, שזו בדיוק
כתובת היעד שלנו. זה פתרון יציב וקבוע, לא זמני — אין צורך בשום פעולה נוספת.

**אם בעתיד תרצו לשלוח לכתובות נוספות, או שכתובת ה"מאת" תהיה `@almogsea.co.il`
ולא `onboarding@resend.dev`**: ב-Resend → Domains → Add Domain → `almogsea.co.il`,
ואז מוסיפים כמה רשומות DNS (SPF/DKIM) אצל מי שמנהל את ה-DNS של הדומיין. זה דורש
גישת DNS שלא בהכרח קיימת אצל כל עובד — לא חובה כדי שהמערכת הנוכחית תעבוד.

תבדקו חיבור מהיר בלי לעבור את כל ה-UI:

```bash
npm run check-email
```

## 4. איך לוודא שזה עובד לפני שליחה ל-60 נהגים

1. **בדיקה מקומית מלאה**: הריצו `npm start` עם `.env` אמיתי, עברו את כל
   המבחן בדפדפן (כולל כשל מכוון — למשל לענות תשובה אחת לא נכונה — כדי לוודא
   שגם מקרה "נכשל" נשלח נכון), וודאו שהגעתם למייל ב-`efi@almogsea.co.il` עם
   PDF מצורף שנראה תקין (עברית, RTL, כל 20 השאלות, תשובה נכונה/שגויה מסומנות).
2. **בדקו את קובץ הגיבוי**: ודאו ש-`data/submissions.csv` מתעדכן בכל הגשה —
   זה הרשת ביטחון שלכם אם מייל בודד לא מגיע.
3. **בדקו ב-production אחרי הדיפלוי**: היכנסו לכתובת הציבורית (מהנייד גם),
   מלאו מבחן טסט מקצה לקצה, ווידאו שהמייל מגיע גם משם — לא רק מקומית (זה בדיוק
   מה שחשף בזמנו שRender חוסם SMTP רגיל, לכן עברנו ל-Resend).
4. **בדקו את מקרה הכשל**: שנו זמנית את `RESEND_API_KEY` לערך שגוי, ווידאו
   שהנהג רואה הודעת שגיאה ברורה עם אפשרות להוריד PDF ולשלוח ידנית — כדי לוודא
   שהנתיב החלופי אכן עובד אם פעם השליחה האוטומטית תיכשל. אל תשכחו להחזיר את
   המפתח הנכון אחרי הבדיקה.
5. רק אחרי ש-1–4 עברו בהצלחה, שלחו את הקישור לכל 60 הנהגים.

## הערות טכניות
- הציון תמיד מחושב מחדש בצד השרת (לא נלקח מהלקוח) — כדי שאי אפשר יהיה לזייף תוצאה.
- ה-PDF שנשלח במייל תמיד בעברית, ללא קשר לשפת המבחן, בדיוק כמו בהתנהגות המקורית.
- מאגר השאלות נקרא ישירות מתוך `public/exam.html` בעליית השרת — אם תעדכנו
  שאלות בעתיד, מספיק לערוך את `public/exam.html` בלבד; השרת יתעדכן אוטומטית
  באתחול הבא.
