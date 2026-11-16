// גרסת האתר (Vercel): אותו לוח, כשהמפתח שמור במשתני הסביבה של האתר ולא בדפדפן
import { buildDashboard, createCaches, envConfig, codeOk } from '../server.js';

const caches = createCaches(); // נשמר בין בקשות כל עוד הפונקציה חמה

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!codeOk(req)) return res.status(401).json({ error: 'code' });
  try {
    res.status(200).json(await buildDashboard(envConfig(), caches, { waitSlowMs: 8000 }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
