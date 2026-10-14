// Download the latest files from every enabled chain, parse them and write:
//   (prices are kept compact: cheapest price per chain, so a run over all stores fits in memory)
//   data/summary.json  light file for the app: cheapest price per product per chain
//   data/report.json   what was fetched, what failed
//
// Usage: node src/fetch.js [--chains=shufersal,rami] [--stores=5] [--online-only]
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePrices, parsePromos, parseStores } from './parse.js';
import { emptyDb, addStores, addPrices, addPromos, buildSummary } from './normalize.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const chainKeys = args.chains ? String(args.chains).split(',') : Object.keys(ADAPTERS);
const maxStores = args.stores ? +args.stores : Infinity; // limit while testing
const onlineOnly = !!args['online-only'];
// promotions (incl. club deals): read from a few stores per chain, enough for chain-wide deals without a long run
const promoStores = args['promo-stores'] != null ? +args['promo-stores'] : 6;

const db = emptyDb({ compact: true });

// Formats that a chain publishes inside its own files but that shoppers know as a separate chain:
// their branches get their own key, so the app compares them on their own prices.
const SPLITS = {
  shufersal: [{ key: 'yeshhesed', name: 'יש חסד', match: (name) => /^\s*יש חסד/.test(name || '') }],
};
const report = { started: new Date().toISOString(), chains: {} };

// results are written after every chain, so a crash late in the run still leaves the chains done so far
// The previous summary (data/prev.json, from the data branch) protects against a bad night: chains sometimes
// replace their files around midnight and list only part of them. A chain that comes back with far fewer
// stores than last time keeps its previous prices, deals and branches instead of shrinking the app's catalog.
let prev = null;
try { prev = JSON.parse(await readFile('data/prev.json', 'utf8')); } catch {}
function withFallback(sum) {
  if (!prev?.products) return sum;
  for (const key of chainKeys) {
    const before = (prev.stores?.[key] || []).length, now = (sum.stores?.[key] || []).length;
    const priced = report.chains[key]?.stores || 0;
    const prevCount = Object.values(prev.products).filter((p) => p.p?.[key] != null).length;
    const nowCount = Object.values(sum.products).filter((p) => p.p?.[key] != null).length;
    if (!prevCount || nowCount >= prevCount * 0.7) continue;
    report.chains[key] ||= { errors: [] };
    report.chains[key].keptPrevious = { prevProducts: prevCount, newProducts: nowCount, storesPriced: priced, prevBranches: before, newBranches: now };
    for (const p of Object.values(sum.products)) { delete p.p[key]; if (p.d) delete p.d[key]; if (p.dc) delete p.dc[key]; }
    for (const [bc, pp] of Object.entries(prev.products)) {
      if (pp.p?.[key] == null) continue;
      const row = (sum.products[bc] ||= { n: pp.n, q: pp.q, p: {}, ...(pp.m ? { m: pp.m } : {}), ...(pp.u ? { u: pp.u } : {}), ...(pp.w ? { w: 1 } : {}) });
      row.p[key] = pp.p[key];
      if (pp.d?.[key]) (row.d ||= {})[key] = pp.d[key];
      if (pp.dc?.[key]) (row.dc ||= {})[key] = pp.dc[key];
    }
    if (before > now) sum.stores[key] = prev.stores[key];
  }
  for (const p of Object.values(sum.products)) { if (p.d && !Object.keys(p.d).length) delete p.d; if (p.dc && !Object.keys(p.dc).length) delete p.dc; }
  for (const [bc, p] of Object.entries(sum.products)) if (!Object.keys(p.p).length) delete sum.products[bc];
  return sum;
}

async function saveOutputs(done = false) {
  if (done) report.finished = new Date().toISOString();
  report.totalProducts = Object.keys(db.products).length;
  await mkdir('data', { recursive: true });
  await writeFile('data/summary.json', JSON.stringify(withFallback(buildSummary(db)))); // even a run cut short keeps the other chains' previous data
  await writeFile('data/report.json', JSON.stringify(report, null, 2));
}

for (const key of chainKeys) {
  const ad = ADAPTERS[key];
  const r = (report.chains[key] = { files: 0, products: 0, promos: 0, errors: [] });
  if (!ad) { r.errors.push('unknown chain'); continue; }
  const t0 = Date.now();
  console.log(`\n▶ ${ad.name}`);
  try {
    const types = ['PriceFull'];
    const files = await ad.list({ maxStores, maxPromoStores: promoStores, types: promoStores > 0 ? ['PriceFull', 'PromoFull'] : ['PriceFull'] });
    console.log(`  ${files.length} files listed (${files.filter((f) => f.type === 'PriceFull').length} stores with prices)`);
    const stores = files.find((f) => f.type === 'Stores');
    let storeInfo = {};
    if (stores) {
      const parsed = parseStores(decodeFile(await ad.download(stores)));
      storeInfo = Object.fromEntries(parsed.stores.map((s) => [s.storeId, s]));
      const own = parsed.stores.filter((s) => !(SPLITS[key] || []).some((sp) => sp.match(s.name)));
      addStores(db, key, ad.name, { ...parsed, stores: own });
      for (const sp of SPLITS[key] || []) addStores(db, sp.key, sp.name, { ...parsed, stores: parsed.stores.filter((s) => sp.match(s.name)) });
      r.files++;
    }
    let storeIds = [...new Set(files.filter((f) => f.type === 'PriceFull').map((f) => f.store))];
    if (onlineOnly) {
      const online = storeIds.filter((id) => ['2', '3'].includes(storeInfo[id]?.type) || /אונליין|online|אינטרנט/i.test(storeInfo[id]?.name || ''));
      if (online.length) storeIds = online; // if the chain does not mark online stores, keep all of them
    }
    storeIds = storeIds.slice(0, maxStores);
    // which chain a store's prices belong to (the chain itself, or a split-off format)
    const owner = (sid) => (SPLITS[key] || []).find((sp) => sp.match(storeInfo[sid]?.name)) || { key, name: ad.name };
    for (const sp of SPLITS[key] || []) report.chains[sp.key] = { splitFrom: key, stores: storeIds.filter((sid) => owner(sid).key === sp.key).length, products: 0, promos: 0, errors: [] };
    for (const sid of storeIds) {
      for (const type of types) {
        const f = files.find((x) => x.type === type && x.store === sid);
        if (!f) continue;
        try {
          const xml = decodeFile(await ad.download(f));
          const o = owner(sid);
          if (type === 'PriceFull') { const p = parsePrices(xml); addPrices(db, o.key, o.name, p); r.products += p.items.length; if (o.key !== key) report.chains[o.key].products += p.items.length; }
          else { const p = parsePromos(xml); addPromos(db, o.key, p); r.promos += p.promos.length; }
          r.files++;
        } catch (e) { r.errors.push(`${f.name}: ${e.message}`); }
      }
    }
    // promotions after all prices, so each deal is priced against the chain's cheapest price
    if (promoStores > 0) {
      const promoFiles = files.filter((f) => f.type === 'PromoFull');
      const pick = [...promoFiles.filter((f) => storeIds.includes(f.store) && (['2', '3'].includes(storeInfo[f.store]?.type) || /אונליין|online|אינטרנט/i.test(storeInfo[f.store]?.name || ''))), ...promoFiles].filter((f, i, a) => a.indexOf(f) === i).slice(0, promoStores);
      // split-off formats get promotions from a few of their own stores (a store-specific listing when the portal has one)
      for (const sp of SPLITS[key] || []) {
        const mine = storeIds.filter((sid) => owner(sid).key === sp.key).slice(0, 3);
        for (const sid of mine) {
          let f = promoFiles.find((x) => x.store === sid);
          if (!f && ad.listStore) { try { f = await ad.listStore('PromoFull', sid); } catch (e) { report.chains[sp.key].errors.push(`promo list ${sid}: ${e.message}`); } }
          if (f && !pick.includes(f)) pick.push(f);
        }
      }
      for (const f of pick) {
        try { const p = parsePromos(decodeFile(await ad.download(f))); const o = owner(f.store); addPromos(db, o.key, p); r.promos += p.promos.length; if (o.key !== key) report.chains[o.key].promos += p.promos.length; r.files++; }
        catch (e) { r.errors.push(`${f.name}: ${e.message}`); }
      }
      for (const sp of SPLITS[key] || []) report.chains[sp.key].deals = Object.values(db.products).filter((p) => p.deals?.[sp.key]).length;
      r.promoStores = pick.length;
      r.deals = Object.values(db.products).filter((p) => p.deals?.[key]).length;
    }
    r.stores = storeIds.length;
    r.heapMB = Math.round(process.memoryUsage().heapUsed / 1048576);
    console.log(`✓ ${ad.name}: ${storeIds.length} stores, ${r.products} prices, ${r.promos} promos, ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    r.errors.push(e.message);
    console.warn(`✗ ${ad.name}: ${e.message}`);
  }
  await saveOutputs();
}

await saveOutputs(true);
console.log(`Done: ${report.totalProducts} products → data/`);
