# פורמט נתונים

CSV עם שורת כותרת. עמודות חובה: `account`, `views`. השאר אופציונליות.

```csv
account,url,date,views,likes,comments,format,hook
@niche_02,https://instagram.com/reel/abc,2026-10-01,148000,5200,310,text-on-screen,"אף אחד לא מספר לכם כמה איטיים 1,000 העוקבים הראשונים."
@niche_02,https://instagram.com/reel/def,2026-09-28,19500,800,40,talking-head,"3 טעויות שעשיתי בשנה הראשונה"
```

- `views` — מספר שלם בלבד (בלי "148K"; הסקריפט כן ממיר K/M אם הודבקו כך).
- לקרוסלות/פוסטים בלי צפיות אפשר לשים בעמודה `views` את סכום likes+comments — אבל אל תערבב באותו חשבון רילסים ופוסטים.
- כדאי 10–30 פוסטים אחרונים לכל חשבון.
