// נתוני הדגמה: מאפשרים לראות את הלוח עובד בלי מפתח API. המספרים זזים קצת בכל קריאה.
const TITLES = [
  'ראש הממשלה בנאום חריף: "לא נעצור עד שנשלים את המשימה"',
  'הסערה מתקרבת: גשמים כבדים צפויים בסוף השבוע',
  'משחק פתיחת העונה: המהפך הדרמטי בדקות האחרונות',
  'מחירי הדירות ממשיכים לעלות: האזורים שבהם הזינוק הגדול ביותר',
  'גורם ביטחוני: "ככל שחולף הזמן, הסיכוי להסדר קטן"',
  'המדריך המלא: כל מה שצריך לדעת לפני החגים',
  'לא נתנו להם לעלות למטוס - הנוסעים מספרים',
  'מחקר חדש: ההרגל היומי שמאריך חיים',
  'הכוכבת חשפה לראשונה את הסיבה לפרידה',
  'מסעדה חדשה בתל אביב: ביקרנו וזה מה שמצאנו',
  'הבורסה בתל אביב נסגרה בעליות חדות',
  'דרמה בכנסת: ההצבעה נדחתה ברגע האחרון',
];

let base = 8000;

export function demoDashboard() {
  base = Math.max(3000, base + Math.round((Math.random() - 0.48) * 200));
  const people = base;
  const pages = TITLES.map((title, i) => ({
    title,
    path: `/news/article/${1000 + i}`,
    people: Math.round((people / 60) * Math.pow(0.88, i) * (0.9 + Math.random() * 0.2)),
    landing: false,
  }));
  pages.push({ title: 'דף הבית', path: '/', people: Math.round(people * 0.12), landing: true });
  pages.sort((a, b) => b.people - a.people);
  const split = (total, shares) =>
    Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, Math.round(total * v)]));
  return {
    host: 'demo.example.com',
    people,
    lastWeek: 8060,
    avg4w: 7299,
    pageviews: 1071059 + Math.round((Date.now() / 1000) % 100000),
    uniques: 181466 + Math.round((Date.now() / 20000) % 5000),
    recircPct: 9 + Math.random() * 2,
    engagedSeconds: 9 + Math.round(Math.random() * 40),
    sources: split(people, { internal: 0.85, direct: 0.07, search: 0.04, social: 0.03, links: 0.02 }),
    devices: split(people, { desktop: 0.71, mobile: 0.29 }),
    readers: split(people, { returning: 0.93, new: 0.07 }),
    pages,
    topLimit: 10,
    errors: [],
    updated: Date.now(),
  };
}
