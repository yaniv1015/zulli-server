// Official street list (data.gov.il "רשימת רחובות בישראל", from the Population Authority) grouped by
// settlement, for the app's address picker. Writes data/diag.json (run through the diagnose workflow).
import { writeFileSync, mkdirSync } from 'node:fs';
const RES = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';
const UA = { 'user-agent': 'Mozilla/5.0 (zulli-server; +https://github.com/yaniv1015/zulli-server)', accept: 'application/json' };
const out = { source: `https://data.gov.il/dataset/321/resource/${RES}`, fetched: new Date().toISOString(), cities: {} };
let offset = 0, total = null, fields = null, err = null;
try {
  while (total == null || offset < total) {
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RES}&limit=32000&offset=${offset}`;
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    const j = JSON.parse(txt);
    total = j.result.total; fields ||= j.result.fields.map((f) => f.id);
    for (const rec of j.result.records) {
      const city = String(rec['שם_ישוב'] || '').replace(/\s+/g, ' ').trim();
      const street = String(rec['שם_רחוב'] || '').replace(/\s+/g, ' ').trim();
      const code = Number(rec['סמל_ישוב']);
      if (!city || !street) continue;
      const c = (out.cities[city] ||= { code, streets: [] });
      c.streets.push(street);
    }
    offset += j.result.records.length;
    if (!j.result.records.length) break;
  }
} catch (e) { err = String(e).slice(0, 300); }
for (const c of Object.values(out.cities)) c.streets = [...new Set(c.streets)].sort((a, b) => a.localeCompare(b, 'he'));
out.total = total; out.fields = fields; out.error = err;
out.count = Object.values(out.cities).reduce((n, c) => n + c.streets.length, 0);
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out));
console.log(JSON.stringify({ total, fields, err, cities: Object.keys(out.cities).length, count: out.count }));
