// בדיקות בלי אינטרנט: פענוח תשובות Chartbeat בתבניות השונות, ושרת שמגיש את הלוח
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parseQuickstats, parseToppages, firstSeries, buildDashboard, startServer } from './server.js';

// quickstats: v4 עטוף ב-data.stats, v3 בשורש
for (const j of [
  { data: { stats: { people: 100, recirc: 10, internal: 85, direct: 7, search: 4, social: 3, links: 1,
    platform: { d: 70, m: 25, t: 5 }, return: 80, loyal: 13, new: 7, engaged_time: { avg: 42 } } } },
  { people: 100, recirc: 10, internal: 85, direct: 7, search: 4, social: 3, links: 1,
    platform: { d: 70, m: 25, t: 5 }, return: 80, loyal: 13, new: 7, engaged_time: { avg: 42 } },
]) {
  const q = parseQuickstats(j);
  assert.equal(q.people, 100);
  assert.equal(q.recircPct, 10);
  assert.deepEqual(q.devices, { desktop: 70, mobile: 30 });
  assert.deepEqual(q.readers, { returning: 93, new: 7 });
  assert.equal(q.sources.internal, 85);
  assert.equal(q.engagedSeconds, 42);
}

const pages = parseToppages({ pages: [
  { path: 'site.co.il/', title: 'בית', stats: { people: 500, type: 'LandingPage' } },
  { path: 'site.co.il/news/1', title: ' כתבה ', stats: { people: 131, type: 'Article' } },
  { path: '/news/2', title: 'שנייה', people: 50 },
] });
assert.deepEqual(pages.map((p) => [p.title, p.people, p.landing]),
  [['בית', 500, true], ['כתבה', 131, false], ['שנייה', 50, false]]);
assert.deepEqual(parseToppages({ data: { pages: [{ path: '/a', title: 'a', stats: { people: 1 } }] } }).length, 1);

assert.deepEqual(firstSeries({ data: { start: 1, 'x.com': { series: { people: [1, 2, 3] } } } }), [1, 2, 3]);

// בלי מפתח: מצב הדגמה
const demo = await buildDashboard({ apiKey: '', host: '', title: 'X' }, {});
assert.equal(demo.demo, true);
assert.ok(demo.people > 0 && demo.pages.length >= 10);

// שרת: מגיש את הדף, את הנתונים, ושומר הגדרות בלי לחשוף את המפתח
const configFile = path.join(os.tmpdir(), `cb-test-${process.pid}.json`);
const { server, port } = await startServer({ port: 0, configFile });
const base = `http://127.0.0.1:${port}`;
assert.match(await (await fetch(base + '/')).text(), /גולשים עכשיו/);
assert.equal((await (await fetch(base + '/api/dashboard')).json()).demo, true);
await fetch(base + '/api/config', { method: 'POST', body: JSON.stringify({ apiKey: 'abcdef123456', host: 'x.co.il', demo: true }) });
assert.equal((await (await fetch(base + '/api/config')).json()).apiKey, '••••3456');
assert.equal((await fetch(base + '/../server.js')).status, 404);
server.close();
console.log('כל הבדיקות עברו');
