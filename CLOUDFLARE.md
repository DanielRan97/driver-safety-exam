# מעבר מ-Render ל-Cloudflare Workers

מדריך פריסה מלא. העיצוב, השאלות, הולידציות, זרימת המבחן — הכל בדיוק כמו
שהיה. רק ה-hosting/backend שונה, כדי שהאתר ייטען מיד בלי מסך "מתעורר"
אחרי חוסר פעילות (בעיה מובנית של Render Free).

## מה השתנה בארכיטקטורה, ולמה

| נושא | Render (ישן) | Cloudflare (חדש) |
|---|---|---|
| שרת | Node/Express רץ כל הזמן (או נרדם) | Cloudflare Worker — רץ מיידית בכל בקשה, בלי "התעוררות" |
| קבצים סטטיים (`index.html`, לוגו) | Express `static` | מוגשים ישירות מהקצה של Cloudflare — אפילו לא מפעילים את ה-Worker |
| יצירת PDF | Puppeteer מקומי על השרת | **Cloudflare Browser Run** — גרסת Puppeteer מרוחקת של Cloudflare (`@cloudflare/puppeteer`). Workers לא יכולים להריץ Chrome בעצמם, אז זה משתמש בדפדפן מרוחק שקלאודפלייר מריצים עבורנו. **חינם עד 10 דקות דפדפן ביום, 3 סשנים במקביל** — בהחלט מספיק לכמות של 60 נהגים. |
| שליחת מייל | Resend HTTP API | **בלי שינוי** — כבר היה מבוסס `fetch()`, לא SMTP, אז זה עבד ב-Workers כבר מהיום הראשון |
| גיבוי הגשות | קובץ CSV מקומי | **Cloudflare KV** (מאגר key-value פשוט) — ל-Workers אין דיסק קבוע בכלל, אז זה התחליף הישיר לקובץ ה-CSV |
| מאגר השאלות ל-PDF/ניקוד | נקרא מ-`public/index.html` בזמן ריצה | נקרא מ-`public/index.html` **בזמן build** (סקריפט `scripts/build-worker-data.js`) ונארז לתוך ה-Worker — ל-Workers אין גישה ל-disk בזמן ריצה |

שינוי הקוד היחיד שהיה "לא קוסמטי": שינוי שם `public/exam.html` ל-
`public/index.html`, כי הגשת קבצים סטטיים ב-Cloudflare (כמו בכל אחסון
סטטי) מצפה ל-`index.html` בשביל הנתיב הראשי `/`. זה שינוי שם קובץ בלבד —
שום דבר בתוכן, בעיצוב, או בהתנהגות לא השתנה.

## 1. מה ליצור ב-Cloudflare

1. חשבון Cloudflare חינמי (אם אין) ב-[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. שום דבר נוסף לא צריך ליצור ידנית בדשבורד עצמו — ה-Worker, ה-Browser
   Run binding וה-KV namespace נוצרים כולם דרך שורת הפקודה (Wrangler)
   בשלבים הבאים.

## 2. התקנה מקומית

```bash
npm install
```

## 3. התחברות ל-Cloudflare (פעם אחת)

```bash
npx wrangler login
```

ייפתח דפדפן לאישור הרשאות. אחרי זה, אימות שזה עבד:

```bash
npx wrangler whoami
```

## 4. יצירת KV namespace לגיבוי ההגשות

```bash
npx wrangler kv namespace create SUBMISSIONS_KV
```

הפקודה תדפיס `id` — תעתיק אותו ותדביק אותו ב-`wrangler.jsonc`, במקום
`REPLACE_WITH_KV_NAMESPACE_ID`:

```jsonc
"kv_namespaces": [
  { "binding": "SUBMISSIONS_KV", "id": "<ה-id שקיבלת כאן>" }
]
```

## 5. הגדרת ה-secret (RESEND_API_KEY)

**לפריסה בפועל (production)** — secret אמיתי, לא בקובץ:

```bash
npx wrangler secret put RESEND_API_KEY
```

יבקש שתדביק את הערך בטרמינל (מתחיל ב-`re_`) — זה אותו מפתח שכבר השתמשת
בו ב-Render.

**לפיתוח מקומי (`npm run dev`)** — צור קובץ `.dev.vars` (יש תבנית ב-
`.dev.vars.example`):

```bash
cp .dev.vars.example .dev.vars
```

ותערוך אותו עם אותו מפתח.

`MAIL_TO` ו-`RESEND_FROM` **לא** סודיים — הם כבר מוגדרים ב-`wrangler.jsonc`
תחת `"vars"`, אין צורך לגעת בהם אלא אם רוצים לשנות את כתובת היעד.

## 6. פריסה

```bash
npm run deploy
```

זה מריץ אוטומטית קודם `npm run build:worker-data` (מייצר את מאגר
השאלות + הגופנים לתוך `worker/generated/`, מתוך `public/index.html` +
`server/fonts/`), ואז `wrangler deploy`.

בסיום תקבלו כתובת ציבורית כמו:
`https://driver-safety-exam.<your-subdomain>.workers.dev`

## 7. איך בודקים שזה עובד ב-production

1. היכנסו לכתובת שקיבלתם — האתר אמור להיטען **מיד**, בלי שום מסך
   "מתעורר" (זה בדיוק מה שרצינו לתקן).
2. עברו מבחן טסט מלא מקצה לקצה (טופס → 20 שאלות → סיום), וודאו שהגיע
   מייל עם PDF תקין ל-`efi@almogsea.co.il`.
3. בדקו רענון עמוד (F5) באמצע המבחן ונווטו ישירות לכתובת הראשית — שניהם
   אמורים לעבוד בלי שגיאה.
4. בדקו את הגיבוי ב-KV:
   ```bash
   npx wrangler kv key list --binding=SUBMISSIONS_KV --remote
   ```
   אמורה להופיע שם רשומה מהבדיקה שלכם.
5. בדקו מובייל (כולל השדה תאריך באייפון) ואת שאר השפות (עברית/אנגלית
   וכו') — שום דבר בעיצוב לא אמור להיראות שונה מאיך שנראה ב-Render.
6. בדקו מקרה שגיאה מכוון: שנו זמנית את ה-secret לערך שגוי
   (`npx wrangler secret put RESEND_API_KEY` עם ערך לא נכון), ווודאו
   שהנהג רואה הודעת שגיאה ברורה עם אפשרות להוריד PDF ידנית. אל תשכחו
   להחזיר את המפתח הנכון אחר כך.

## 8. פיתוח מקומי (`npm run dev`)

```bash
npm run dev
```

**הערה חשובה**: יצירת ה-PDF (Browser Run) דורשת חיבור אמיתי לענן של
Cloudflare — לא ניתן לדמות דפדפן מרוחק לגמרי במחשב המקומי. אם `wrangler
dev` הרגיל נכשל ספציפית בשלב יצירת ה-PDF, הריצו עם `--remote`:

```bash
npx wrangler dev --remote
```

זה מפעיל שרת מקומי (`http://localhost:8787`) שמדבר עם ה-bindings
האמיתיים (Browser Run, KV) בענן של Cloudflare, במקום לנסות לדמות אותם
מקומית.

## 9. הסרת Render (רק אחרי שווידאתם שCloudflare עובד!)

**אל תמחקו את Render לפני שסעיף 7 עבר בהצלחה במלואו.** קוד ה-Render
(`server/`, `Procfile`-style config) נשאר בפרויקט בלי לפגוע בכלום —
אפשר להריץ אותו מקומית תמיד עם:

```bash
npm run start:render
```

כשאתם בטוחים ש-Cloudflare עובד מצוין ל-100%, ורוצים להפסיק את Render:

1. ב-Render → השירות `driver-safety-exam` → **Settings** → גללו למטה
   ל-**Delete Web Service** (או פשוט **Suspend** אם רוצים לשמור אפשרות
   חזרה מהירה בלי למחוק לגמרי).
2. עדכנו כל קישור/מסמך פנימי שמצביע לכתובת הישנה של Render לכתובת החדשה
   של Cloudflare.
3. (אופציונלי, ניקיון) אפשר למחוק את `server/` ו-`Procfile`/הגדרות
   Render-specific מהריפו בפריסה נפרדת, אחרי שהכל יציב — לא חובה.

## סיכום משתני סביבה / secrets

| שם | סוג | איפה מוגדר | הערה |
|---|---|---|---|
| `RESEND_API_KEY` | Secret | `wrangler secret put` (production) / `.dev.vars` (local) | אותו מפתח כמו ב-Render |
| `MAIL_TO` | Var | `wrangler.jsonc` → `vars` | ברירת מחדל: `efi@almogsea.co.il` |
| `RESEND_FROM` | Var | `wrangler.jsonc` → `vars` | ברירת מחדל: `onboarding@resend.dev` |
| `SUBMISSIONS_KV` id | Config | `wrangler.jsonc` → `kv_namespaces` | מ-`wrangler kv namespace create` |
