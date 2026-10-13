// Why do promotions turn into deals or not? Downloads a few PromoFull files and counts reasons. Writes data/diag.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePromos, parsePrices } from './parse.js';
import { dealFor } from './normalize.js';
const out = {};
for (const key of ['shufersal', 'yochananof', 'osherad', 'carrefour']) {
  const ad = ADAPTERS[key]; const o = (out[key] = {});
  try {
    const files = await ad.list({ maxStores: 3, maxPromoStores: 2, maxPages: 2, types: ['PriceFull', 'PromoFull'] });
    o.listed = files.reduce((m, f) => (m[f.type] = (m[f.type] || 0) + 1, m), {});
    o.sampleNames = files.slice(0, 5).map((f) => f.name);
    const pf = files.find((f) => f.type === 'PromoFull'); const prf = files.find((f) => f.type === 'PriceFull' && pf && f.store === pf.store) || files.find((f) => f.type === 'PriceFull');
    if (!pf) { o.err = 'no PromoFull'; continue; }
    const promos = parsePromos(decodeFile(await ad.download(pf)));
    const prices = prf ? parsePrices(decodeFile(await ad.download(prf))) : { items: [] };
    const base = new Map(prices.items.map((i) => [i.barcode.replace(/^0+(?=\d{8,})/, ''), i.price]));
    const why = {}; const ex = [];
    for (const p of promos.promos) {
      const bc = p.barcodes[0].replace(/^0+(?=\d{8,})/, ''); const b = base.get(bc);
      let r;
      if (b == null) r = 'no price for barcode';
      else if (p.isGiftItem) r = 'gift'; else if (p.minPurchaseAmount > 0) r = 'basket minimum';
      else { const d = dealFor(p, b); r = d ? 'deal' : 'rejected'; if (ex.length < 12) ex.push({ base: b, d, p: { ...p, barcodes: p.barcodes.length } }); }
      why[r] = (why[r] || 0) + 1;
    }
    o.store = pf.store; o.promos = promos.promos.length; o.why = why; o.examples = ex;
  } catch (e) { o.err = String(e).slice(0, 200); }
}
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 2000));
