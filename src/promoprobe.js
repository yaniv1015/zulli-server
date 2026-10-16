// Diagnostic: raw promotion blocks for some barcodes in some stores of one chain → data/diag.json
// env: CHAIN (default shukhayir), STORES (comma list, default 5,6), CODES (comma list of barcodes)
import { mkdir, writeFile } from 'node:fs/promises';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePromos } from './parse.js';

const chain = process.env.CHAIN || 'shukhayir';
const stores = (process.env.STORES || '5,6').split(',');
const codes = (process.env.CODES || '7290112002136,7290112002143,7290112002167,7290112002150').split(',');
const ad = ADAPTERS[chain];
const out = { chain, stores: {}, started: new Date().toISOString() };
const files = (await ad.list({ maxPromoStores: Infinity, types: ['PromoFull'] })).filter((f) => f.type === 'PromoFull');
for (const sid of stores) {
  const f = files.find((x) => String(x.store).replace(/^0+(?=\d)/, '') === sid);
  if (!f) { out.stores[sid] = 'no file'; continue; }
  const xml = decodeFile(await ad.download(f));
  const blocks = xml.split(/<Promotion>/i).slice(1).map((b) => '<Promotion>' + b.split(/<\/Promotion>/i)[0] + '</Promotion>');
  const hits = blocks.filter((b) => codes.some((c) => b.includes(c)) || b.includes('קולון'));
  const parsed = parsePromos(xml).promos.filter((p) => p.barcodes.some((c) => codes.includes(c)) || /קולון/.test(p.description));
  out.stores[sid] = { file: f.name, promos: blocks.length, raw: hits.map((b) => b.replace(/<Item>[\s\S]*?<\/Item>/g, (m) => codes.some((c) => m.includes(c)) ? m : '').slice(0, 3000)), parsed: parsed.map((p) => ({ ...p, barcodes: p.barcodes.length })) };
}
await mkdir('data', { recursive: true });
await writeFile('data/diag.json', JSON.stringify(out, null, 1));
console.log('done');
