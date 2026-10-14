// Times the promotion step of one chain (download, parse, turning promotions into deals).
import { writeFileSync, mkdirSync } from 'node:fs';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePrices, parsePromos } from './parse.js';
import { emptyDb, addPrices, addPromos } from './normalize.js';
mkdirSync('data', { recursive: true });
const out = { steps: [] };
const save = () => writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
const step = (s) => { s.at = new Date().toISOString(); out.steps.push(s); save(); console.log(JSON.stringify(s).slice(0, 400)); };
for (const key of (process.env.CHAINS || 'tivtaam').split(',')) {
  const ad = ADAPTERS[key]; const db = emptyDb({ compact: true });
  const files = await ad.list({ maxPromoStores: 6, types: ['PriceFull', 'PromoFull'] });
  for (const f of files.filter((x) => x.type === 'PriceFull').slice(0, 3)) addPrices(db, key, key, parsePrices(decodeFile(await ad.download(f))));
  step({ key, phase: 'prices', products: Object.keys(db.products).length });
  for (const f of files.filter((x) => x.type === 'PromoFull').slice(0, 6)) {
    let t = Date.now(); const buf = await ad.download(f); const xml = decodeFile(buf);
    step({ key, f: f.name, phase: 'promo-downloaded', bytes: buf.length, xmlLen: xml.length, ms: Date.now() - t, head: xml.slice(0, 1500) });
    t = Date.now(); const p = parsePromos(xml);
    step({ key, f: f.name, phase: 'promo-parsed', promos: p.promos.length, maxItems: Math.max(0, ...p.promos.map((x) => x.barcodes.length)), ms: Date.now() - t });
    t = Date.now(); addPromos(db, key, p);
    step({ key, f: f.name, phase: 'promo-added', ms: Date.now() - t });
  }
}
step({ phase: 'done' });
