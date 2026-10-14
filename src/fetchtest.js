// Quick check of new chains: list files, then parse one Stores file and one PriceFull and PromoFull file each. Writes data/diag.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePrices, parsePromos, parseStores } from './parse.js';
const keys = (process.env.CHAINS || 'tivtaam,keshet,stopmarket,freshmarket,polizer,dabach,doralon,kingstore,maayan,shefa,supersapir,shukhayir,zolbegadol,bareket,goodpharm,citymarket,meshnat,wolt').split(',');
const out = {};
for (const k of keys) {
  const ad = ADAPTERS[k]; const o = (out[k] = {}); const t0 = Date.now();
  try {
    const files = await ad.list({ maxStores: Infinity, maxPromoStores: 3, types: ['PriceFull', 'PromoFull'] });
    o.listed = files.reduce((m, f) => (m[f.type] = (m[f.type] || 0) + 1, m), {});
    o.sample = files.slice(0, 2).map((f) => f.name);
    const st = files.find((f) => f.type === 'Stores');
    if (st) { const p = parseStores(decodeFile(await ad.download(st))); o.stores = p.stores.length; o.storeSample = p.stores.slice(0, 3).map((s) => `${s.storeId} ${s.name} | ${s.city} | ${s.type}`); }
    const pf = files.find((f) => f.type === 'PriceFull');
    if (pf) { const p = parsePrices(decodeFile(await ad.download(pf))); o.items = p.items.length; o.itemSample = p.items.slice(0, 2).map((i) => `${i.barcode} ${i.name} ${i.price}`); }
    const pr = files.find((f) => f.type === 'PromoFull');
    if (pr) { const p = parsePromos(decodeFile(await ad.download(pr))); o.promos = p.promos.length; }
  } catch (e) { o.err = String(e.message || e).slice(0, 200); }
  o.secs = Math.round((Date.now() - t0) / 1000);
  console.log(k, JSON.stringify(o));
}
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
