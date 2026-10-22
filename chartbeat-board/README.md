# Chartbeat Board · לוח גולשים בזמן אמת

אפליקציה למחשב (Windows / Mac / Linux) שמציגה על מסך במערכת את נתוני Chartbeat:
גולשים עכשיו מול שבוע שעבר ומול ממוצע 4 שבועות, צפיות ויוניקים מתחילת היום,
המשך גלישה, זמן מעורבות, 10 הכתבות המובילות, מקורות תנועה, מכשיר וסוג קורא.

## הפעלה

```bash
cd chartbeat-board
npm install
npm start          # חלון רגיל (F11 מסך מלא, F5 רענון)
npm run kiosk      # נפתח ישר במסך מלא, למסך תלוי
```

בפתיחה הראשונה הלוח במצב הדגמה. לוחצים על ⚙ בפינה ומזינים:
- **מפתח API** של Chartbeat (Settings → API Keys, מפתח עם הרשאת All/Historical)
- **host** — שם האתר כפי שמוגדר ב-Chartbeat, למשל `example.co.il`

ההגדרות נשמרות במחשב בלבד. המפתח לא מגיע לדפדפן: שרת מקומי קטן קורא ל-Chartbeat ומעביר ללוח רק את המספרים.

### בלי Electron
אפשר להריץ רק את השרת (Node 20 ומעלה, בלי `npm install`) ולפתוח בכל דפדפן:
```bash
node server.js            # http://localhost:8080
node server.js --demo     # נתוני הדגמה
```
אפשר גם להגדיר דרך משתני סביבה `CHARTBEAT_API_KEY` ו-`CHARTBEAT_HOST`, או קובץ `config.json` (ראו `config.example.json`).

### קובץ התקנה
```bash
npm run dist:win   # dist/Chartbeat Board.exe (נייד, בלי התקנה)
npm run dist:mac
```

## מאיפה כל מספר מגיע

| בלוח | קריאה ל-Chartbeat | רענון |
|---|---|---|
| גולשים עכשיו, המשך גלישה, זמן מעורבות, מקורות, מכשיר, סוג קורא | `live/quickstats/v4` | כל 15 שניות |
| כתבות מובילות | `live/toppages/v4` | כל 15 שניות |
| שבוע שעבר / ממוצע 4 שבועות | `historical/traffic/series` (אותה שעה לפני 7/14/21/28 יום) | כל 5 דקות |
| צפיות ויוניקים היום | `query/v2` (Advanced Queries) | כל 5 דקות |

ערך שלא התקבל מוצג כ-"—" והסיבה כתובה בשורה התחתונה. ההשוואות ההיסטוריות והצפיות היומיות דורשות חבילה שכוללת Historical / Advanced Queries.

**בדיקה מול החשבון:** `npm run probe` מדפיס את התשובות הגולמיות מ-Chartbeat. אם שדה כלשהו לא מופיע בלוח, הפלט הזה מראה איך החשבון שלכם קורא לו.

"הסתר דפי נחיתה" מסתיר את דף הבית, ודפים ש-Chartbeat מסמן כ-LandingPage או שנתיבם category/tag/section.

## בדיקות
```bash
npm test
```
