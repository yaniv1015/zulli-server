// שרת קטן בלי תלויות: מושך נתונים מ-Chartbeat, מאחד אותם לתשובה אחת ומגיש את הלוח.
// המפתח נשאר בשרת ולא מגיע לדפדפן.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoDashboard } from './demo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const API = 'https://api.chartbeat.com';

const DEFAULTS = {
  apiKey: '',
  host: '',
  title: 'CHART BEET',
  refreshSeconds: 15,
  topLimit: 10,
  timeZone: 'Asia/Jerusalem',
  demo: false,
};

// ---------- הגדרות ----------

export function loadConfig(file) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const cfg = { ...DEFAULTS, ...saved };
  if (process.env.CHARTBEAT_API_KEY) cfg.apiKey = process.env.CHARTBEAT_API_KEY;
  if (process.env.CHARTBEAT_HOST) cfg.host = process.env.CHARTBEAT_HOST;
  if (process.env.CHARTBEAT_DEMO === '1') cfg.demo = true;
  return cfg;
}

function saveConfig(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

// ---------- קריאות ל-Chartbeat ----------

async function cb(cfg, endpoint, params = {}, { text = false } = {}) {
  const url = new URL(endpoint, API);
  url.searchParams.set('host', cfg.host);
  url.searchParams.set('apikey', cfg.apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'X-CB-AK': cfg.apiKey, accept: text ? '*/*' : 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  return text ? res.text() : res.json();
}

// מנסה את הגרסה החדשה ואם היא לא קיימת לחשבון, את v3 שמופיעה בהדרכה של Chartbeat
const cbLive = (cfg, name, params) =>
  cb(cfg, `/live/${name}/v4/`, params).catch(() => cb(cfg, `/live/${name}/v3/`, params));

const num = (...vals) => {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
};

// גרסאות ה-API מחזירות את הנתונים בעטיפות שונות (data.stats / stats / שורש)
const unwrap = (j, key) => j?.data?.[key] ?? j?.[key] ?? j?.data ?? j;

export function parseQuickstats(j) {
  const s = unwrap(j, 'stats');
  const people = num(s.people, s.visits);
  const pl = s.platform ?? {};
  const devices = {
    desktop: num(pl.d, pl.desktop),
    mobile: num(pl.m, pl.mobile) + num(pl.t, pl.tablet) + num(pl.a, pl.app),
  };
  const returning = num(s.return, s.returning) + num(s.loyal);
  const readers = { returning, new: num(s.new, s.type?.new) };
  if (!readers.returning && s.type) readers.returning = num(s.type.returning) + num(s.type.loyal);
  const sources = {
    internal: num(s.internal),
    direct: num(s.direct),
    search: num(s.search),
    social: num(s.social),
    links: num(s.links),
  };
  const engaged = s.engaged_time ?? s.engagedTime ?? {};
  return {
    people,
    devices,
    readers,
    sources,
    engagedSeconds: num(engaged.avg, engaged.median, s.avg_engaged_time, s.engaged_time),
    recircPct: people ? (num(s.recirc) / people) * 100 : 0,
  };
}

export function parseToppages(j) {
  const raw = unwrap(j, 'pages');
  const pages = Array.isArray(raw) ? raw : raw?.pages ?? [];
  return pages.map((p) => {
    const st = p.stats ?? {};
    const type = st.type ?? p.type ?? '';
    const p0 = String(p.path ?? '');
    return {
      title: String(p.title ?? p0).trim(),
      path: p0,
      people: num(st.people, p.people, st.visits, p.visits),
      landing: /landing/i.test(type) || /^[^/]*\/?$/.test(p0) || /\/(category|tag|section|channel)\//i.test(p0),
    };
  });
}

// מוצא בתשובה את המערך המספרי הראשון (תבנית התשובה של series משתנה בין גרסאות)
export function firstSeries(j) {
  if (Array.isArray(j) && j.some((v) => typeof v === 'number')) return j;
  if (j && typeof j === 'object') {
    for (const v of Object.values(j)) {
      const s = firstSeries(v);
      if (s) return s;
    }
  }
  return null;
}

// ממוצע הגולשים בחלון של 10 דקות סביב אותה שעה לפני N ימים
async function peopleDaysAgo(cfg, days) {
  const t = Math.floor(Date.now() / 1000) - days * 86400;
  const j = await cb(cfg, '/historical/traffic/series/', {
    fields: 'people', start: t - 300, end: t + 300, frequency: 5,
  });
  const s = (firstSeries(j) ?? []).filter((v) => typeof v === 'number');
  if (!s.length) throw new Error('historical series ריק');
  return s.reduce((a, b) => a + b, 0) / s.length;
}

async function comparisons(cfg) {
  const weeks = await Promise.allSettled([7, 14, 21, 28].map((d) => peopleDaysAgo(cfg, d)));
  const vals = weeks.filter((w) => w.status === 'fulfilled').map((w) => w.value);
  return {
    lastWeek: weeks[0].status === 'fulfilled' ? Math.round(weeks[0].value) : null,
    avg4w: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    error: weeks.find((w) => w.status === 'rejected')?.reason?.message,
  };
}

// צפיות וייחודיים מתחילת היום: שאילתה ב-Advanced Queries (שליחה, המתנה, משיכת CSV)
async function todayTotals(cfg) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timeZone }).format(new Date());
  const sub = await cb(cfg, '/query/v2/submit/page/', {
    start: day, end: day, tz: cfg.timeZone, metrics: 'page_views,page_uniques',
  });
  const id = sub.query_id ?? sub.data?.query_id;
  if (!id) throw new Error('query: אין query_id');
  for (let i = 0; i < 20; i++) {
    const st = await cb(cfg, '/query/v2/status/', { query_id: id });
    const status = String(st.status ?? st.data?.status ?? '').toLowerCase();
    if (status === 'completed') break;
    if (status === 'failed' || status === 'error') throw new Error('query נכשלה');
    await new Promise((r) => setTimeout(r, 1500));
  }
  const csv = await cb(cfg, '/query/v2/fetch/', { query_id: id }, { text: true });
  const [head, ...rows] = csv.trim().split(/\r?\n/).map((l) => l.split(','));
  const sum = (col) => {
    const i = head.indexOf(col);
    return i < 0 ? null : rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);
  };
  return { pageviews: sum('page_views'), uniques: sum('page_uniques') };
}

// ---------- איחוד ומטמון ----------

// נתונים שמשתנים לאט מתעדכנים ברקע כל 5 דקות (גם אחרי כישלון), כדי לא לעבור את
// מגבלת הקריאות ולא לעכב את הלוח בזמן ששאילתה ארוכה רצה
function slowCache(fn, ms = 5 * 60 * 1000) {
  let value = null, error = null, at = 0, pending = null;
  return (cfg) => {
    if (!pending && Date.now() - at > ms) {
      pending = fn(cfg)
        .then((v) => { value = v; error = null; }, (e) => { error = e.message; })
        .finally(() => { at = Date.now(); pending = null; });
    }
    return { value, error };
  };
}

export async function buildDashboard(cfg, caches) {
  if (cfg.demo || !cfg.apiKey || !cfg.host) {
    return { ...demoDashboard(), demo: true, configured: Boolean(cfg.apiKey && cfg.host), title: cfg.title };
  }
  const [qs, tp] = await Promise.allSettled([
    cbLive(cfg, 'quickstats').then(parseQuickstats),
    cbLive(cfg, 'toppages', { limit: 50 }).then(parseToppages),
  ]);
  const cmp = caches.comparisons(cfg);
  const tot = caches.totals(cfg);
  const errors = [qs.reason?.message, tp.reason?.message, cmp.error, cmp.value?.error, tot.error].filter(Boolean);
  const q = qs.status === 'fulfilled' ? qs.value : null;
  return {
    title: cfg.title,
    host: cfg.host,
    configured: true,
    demo: false,
    people: q?.people ?? null,
    lastWeek: cmp.value?.lastWeek ?? null,
    avg4w: cmp.value?.avg4w ?? null,
    pageviews: tot.value?.pageviews ?? null,
    uniques: tot.value?.uniques ?? null,
    recircPct: q?.recircPct ?? null,
    engagedSeconds: q?.engagedSeconds ?? null,
    sources: q?.sources ?? null,
    devices: q?.devices ?? null,
    readers: q?.readers ?? null,
    pages: tp.status === 'fulfilled' ? tp.value : [],
    topLimit: cfg.topLimit,
    errors,
    updated: Date.now(),
  };
}

// ---------- שרת HTTP ----------

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function startServer({ port = 8080, configFile = path.join(HERE, 'config.json') } = {}) {
  let cfg = loadConfig(configFile);
  const caches = { comparisons: slowCache(comparisons), totals: slowCache(todayTotals) };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === '/api/dashboard') return json(200, await buildDashboard(cfg, caches));
      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(200, { ...cfg, apiKey: cfg.apiKey ? '••••' + cfg.apiKey.slice(-4) : '' });
      }
      if (url.pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const next = JSON.parse(body || '{}');
        if (!next.apiKey || next.apiKey.startsWith('••••')) delete next.apiKey; // שדה ריק או מוסתר = לא לשנות
        cfg = { ...cfg, ...next };
        saveConfig(configFile, cfg);
        caches.comparisons = slowCache(comparisons);
        caches.totals = slowCache(todayTotals);
        return json(200, { ok: true });
      }
      const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': (TYPES[path.extname(file)] ?? 'application/octet-stream') + '; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      json(500, { error: e.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// הרצה ישירה: node server.js [--port=8080] [--demo] [--probe]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`));
  if (arg('demo')) process.env.CHARTBEAT_DEMO = '1';
  if (arg('probe')) {
    // מדפיס את התשובות הגולמיות מ-Chartbeat, לבדיקה שהחשבון מחזיר את מה שהלוח מצפה לו
    const cfg = loadConfig(path.join(HERE, 'config.json'));
    for (const [ep, p] of [['/live/quickstats/v4/', {}], ['/live/quickstats/v3/', {}], ['/live/toppages/v4/', { limit: 3 }], ['/live/toppages/v3/', { limit: 3 }]]) {
      try { console.log(ep, JSON.stringify(await cb(cfg, ep, p), null, 2)); } catch (e) { console.log(ep, 'שגיאה:', e.message); }
    }
    try { console.log('comparisons', await comparisons(cfg)); } catch (e) { console.log('comparisons שגיאה:', e.message); }
    try { console.log('today', await todayTotals(cfg)); } catch (e) { console.log('today שגיאה:', e.message); }
    process.exit(0);
  }
  const port = Number(arg('port')?.split('=')[1] ?? 8080);
  const { port: p } = await startServer({ port });
  console.log(`הלוח פועל: http://localhost:${p}`);
}
