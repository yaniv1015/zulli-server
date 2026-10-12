// Download the latest files from every enabled chain, parse them and write:
//   data/db.json       full catalog (prices per store + promotions)
//   data/summary.json  light file for the app: cheapest price per product per chain
//   data/report.json   what was fetched, what failed
//
// Usage: node src/fetch.js [--chains=shufersal,rami] [--stores=5] [--online-only]
import { mkdir, writeFile } from 'node:fs/promises';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePrices, parsePromos, parseStores } from './parse.js';
import { emptyDb, addStores, addPrices, addPromos, buildSummary } from './normalize.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const chainKeys = args.chains ? String(args.chains).split(',') : Object.keys(ADAPTERS);
const maxStores = args.stores ? +args.stores : Infinity; // limit while testing
const onlineOnly = !!args['online-only'];

const db = emptyDb();
const report = { started: new Date().toISOString(), chains: {} };

for (const key of chainKeys) {
  const ad = ADAPTERS[key];
  const r = (report.chains[key] = { files: 0, products: 0, promos: 0, errors: [] });
  if (!ad) { r.errors.push('unknown chain'); continue; }
  try {
    const files = await ad.list();
    const stores = files.find((f) => f.type === 'Stores');
    let storeInfo = {};
    if (stores) {
      const parsed = parseStores(decodeFile(await ad.download(stores)));
      addStores(db, key, ad.name, parsed);
      storeInfo = Object.fromEntries(parsed.stores.map((s) => [s.storeId, s]));
      r.files++;
    }
    let storeIds = [...new Set(files.filter((f) => f.type === 'PriceFull').map((f) => f.store))];
    if (onlineOnly) storeIds = storeIds.filter((id) => ['2', '3'].includes(storeInfo[id]?.type) || /אונליין|online|אינטרנט/i.test(storeInfo[id]?.name || ''));
    storeIds = storeIds.slice(0, maxStores);
    for (const sid of storeIds) {
      for (const type of ['PriceFull', 'PromoFull']) {
        const f = files.find((x) => x.type === type && x.store === sid);
        if (!f) continue;
        try {
          const xml = decodeFile(await ad.download(f));
          if (type === 'PriceFull') { const p = parsePrices(xml); addPrices(db, key, ad.name, p); r.products += p.items.length; }
          else { const p = parsePromos(xml); addPromos(db, key, p); r.promos += p.promos.length; }
          r.files++;
        } catch (e) { r.errors.push(`${f.name}: ${e.message}`); }
      }
    }
    console.log(`✓ ${ad.name}: ${storeIds.length} stores, ${r.products} prices, ${r.promos} promos`);
  } catch (e) {
    r.errors.push(e.message);
    console.warn(`✗ ${ad.name}: ${e.message}`);
  }
}

report.finished = new Date().toISOString();
report.totalProducts = Object.keys(db.products).length;
await mkdir('data', { recursive: true });
await writeFile('data/db.json', JSON.stringify(db));
await writeFile('data/summary.json', JSON.stringify(buildSummary(db)));
await writeFile('data/report.json', JSON.stringify(report, null, 2));
console.log(`Done: ${report.totalProducts} products → data/`);
