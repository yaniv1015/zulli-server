// באתר ההגדרות קבועות (משתני סביבה), אז מחזירים רק את מה שהדף צריך ומסמנים שאין עריכה
import { envConfig } from '../server.js';

export default function handler(req, res) {
  const { title, refreshSeconds, topLimit } = envConfig();
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ hosted: true, title, refreshSeconds, topLimit });
}
