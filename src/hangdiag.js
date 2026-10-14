// Where does a full run of one chain get stuck? Times every listing, download and parse, and saves progress after each step.
import { writeFileSync, mkdirSync } from 'node:fs';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePrices, parsePromos, parseStores } from './parse.js';
mkdirSync('data', { recursive: true });
const out = { steps: [] };
const save = () => writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
const step = (s) => { s.at = new Date().toISOString(); out.steps.push(s); save(); console.log(JSON.stringify(s)); };
for (const key of (process.env.CHAINS || 'tivtaam,keshet').split(',')) {
  const ad = ADAPTERS[key]; let t = Date.now();
  step({ key, phase: 'list-start' });
  const files = await ad.list({ maxPromoStores: 6, types: ['PriceFull', 'PromoFull'] });
  step({ key, phase: 'listed', n: files.length, ms: Date.now() - t });
  for (const f of files.filter((x) => x.type === 'PriceFull').slice(0, 60)) {
    t = Date.now(); let buf;
    try { buf = await ad.download(f); } catch (e) { step({ key, f: f.name, phase: 'download-error', err: e.message, ms: Date.now() - t }); continue; }
    const dms = Date.now() - t; t = Date.now();
    const xml = decodeFile(buf); const decMs = Date.now() - t; t = Date.now();
    step({ key, f: f.name, phase: 'parsing', bytes: buf.length, xmlLen: xml.length, dms, decMs, head: xml.slice(0, 300) });
    const p = parsePrices(xml);
    step({ key, f: f.name, phase: 'parsed', items: p.items.length, ms: Date.now() - t });
  }
}
step({ phase: 'done' });
