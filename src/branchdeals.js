// Deals per branch.
// Chains publish a deal file for every store, and some deals run only in some stores (one city, one region).
// The price run reads deals from a few stores per chain and treats them as chain-wide. This run reads every
// store's deal file and keeps, per store, only what differs from the chain-wide deal:
//
//   per store: the deals this store has that the chain-wide data does not (or has with other terms),
//   and the chain-wide deals (regular / club) this store does not offer. File format: see the end of this file.
//   deal = [kind, n, price|pct, club, end, desc], as in summary.json; NN = the same bucket as data/br/NN.json
//
// Inputs: data/summary.json and data/br/*.json from the latest price run (the base price of every product per store).
// Usage: node src/branchdeals.js [--chains=keshet,tivtaam] [--stores=20]
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { ADAPTERS } from './adapters.js';
import { decodeFile, parsePromos } from './parse.js';
import { branchDealDiff, branchBucket, BRANCH_BUCKETS } from './normalize.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const DATA = process.env.DATA_DIR || 'data';
const OUT = process.env.BD_DIR || `${DATA}/bd`;
const CHAIN_MINUTES = Number(process.env.CHAIN_MINUTES || 30);
const PARALLEL = Number(process.env.PARALLEL || 4);
process.on('unhandledRejection', (e) => console.error('unhandled', e));
const maxStores = args.stores ? +args.stores : Infinity;

const summary = JSON.parse(await readFile(`${DATA}/summary.json`, 'utf8'));
const br = {};
try { for (const f of await readdir(`${DATA}/br`)) if (f.endsWith('.json')) Object.assign(br, JSON.parse(await readFile(`${DATA}/br/${f}`, 'utf8'))); } catch {}

// split-off formats (their stores are listed inside another chain's files)
const SPLIT_OF = { yeshhesed: 'shufersal' };
const storeChain = {};
for (const [chain, list] of Object.entries(summary.stores || {})) for (const s of list || []) storeChain[`${SPLIT_OF[chain] || chain}:${String(s.id).replace(/^0+(?=\d)/, '')}`] = chain;

const out = {};
const report = { started: new Date().toISOString(), basedOn: summary.updated, chains: {} };
const diffFor = branchDealDiff(summary, br);

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// Compact files: chain-wide deal lists and a table of branch deals per chain in idx.json; per store, bitmaps over
// the chain-wide lists (x / xc) and indices into the table (o).
//   bd/i/<chain>.json = { b: [barcodes with a chain-wide regular deal], bc: [... club deal], t: [[barcode, deal], ...] }
//   bd/NN.json  = { "chain:store": { x?: base64 bitmap over b, xc?: bitmap over bc, o?: "i,j,k" (base36 indices into t) } }
const idx = {};
const listOf = (chain) => idx[chain] ||= (() => {
  const b = [], bc = [];
  for (const [code, row] of Object.entries(summary.products)) { if (row.d?.[chain]) b.push(code); if (row.dc?.[chain]) bc.push(code); }
  return { b, bc, t: [], _t: new Map(), _b: new Map(b.map((x, i) => [x, i])), _bc: new Map(bc.map((x, i) => [x, i])) };
})();
const bitmap = (codes, pos, n) => { const bytes = new Uint8Array(Math.ceil(n / 8)); for (const c of codes) { const i = pos.get(c); if (i != null) bytes[i >> 3] |= 1 << (i & 7); } return Buffer.from(bytes).toString('base64'); };
/** one store's differences, compacted right away (keeping the barcode lists of every store ran out of memory) */
function compact(chain, v) {
  const L = listOf(chain); const e = {};
  if (v.x) e.x = bitmap(v.x, L._b, L.b.length);
  if (v.xc) e.xc = bitmap(v.xc, L._bc, L.bc.length);
  const own = [...Object.entries(v.d || {}), ...Object.entries(v.c || {})].map(([code, deal]) => {
    const key = code + '|' + JSON.stringify(deal); let i = L._t.get(key);
    if (i == null) { i = L.t.length; L.t.push([code, deal]); L._t.set(key, i); }
    return i;
  }).sort((a, b) => a - b);
  if (own.length) e.o = own.map((i) => i.toString(36)).join(',');
  return e;
}
// A run over some chains only (--chains=…) keeps the other chains' branch deals: PREV_DIR holds the last published output.
const PREV_DIR = process.env.PREV_DIR || '';
const rerun = new Set(args.chains ? String(args.chains).split(',').flatMap((k) => k === 'shufersal' ? [k, 'yeshhesed'] : [k]) : []);
async function readJSON(f) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } }
async function writeOut() {
  await mkdir(`${OUT}/i`, { recursive: true });
  const buckets = Array.from({ length: BRANCH_BUCKETS }, () => ({}));
  if (PREV_DIR && rerun.size) {
    for (let i = 0; i < BRANCH_BUCKETS; i++) {
      const old = await readJSON(`${PREV_DIR}/${String(i).padStart(2, '0')}.json`) || {};
      for (const [k, e] of Object.entries(old)) if (!rerun.has(k.split(':')[0])) buckets[i][k] = e;
    }
    for (const f of await readdir(`${PREV_DIR}/i`).catch(() => [])) {
      const c = f.replace(/\.json$/, '');
      if (!rerun.has(c) && !idx[c]) await writeFile(`${OUT}/i/${f}`, await readFile(`${PREV_DIR}/i/${f}`));
    }
  }
  for (const [k, e] of Object.entries(out)) { const [chain, sid] = k.split(':'); buckets[branchBucket(chain, sid)][k] = e; }
  for (let i = 0; i < buckets.length; i++) await writeFile(`${OUT}/${String(i).padStart(2, '0')}.json`, JSON.stringify(buckets[i]));
  // one index file per chain, so the app downloads only the chains whose branches it looks at
  for (const [c, L] of Object.entries(idx)) await writeFile(`${OUT}/i/${c}.json`, JSON.stringify({ b: L.b, bc: L.bc, t: L.t }));
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}

const chainKeys = args.chains ? String(args.chains).split(',') : [...Object.keys(ADAPTERS).filter((k) => k !== 'shufersal'), 'shufersal'];
for (const key of chainKeys) {
  const ad = ADAPTERS[key];
  const r = (report.chains[key] = { files: 0, stores: 0, withDiff: 0, errors: [] });
  if (!ad) { r.errors.push('unknown chain'); continue; }
  const t0 = Date.now();
  console.log(`\n▶ ${ad.name}`);
  try {
    // Shufersal's full listing times out; its listing filtered by store is quick, so each branch is listed on its own
    const perStore = key === 'shufersal' && ad.listStore;
    const known = perStore ? Object.entries(storeChain).filter(([k]) => k.startsWith(key + ':')).map(([k]) => k.split(':')[1]) : [];
    const files = perStore ? known.map((sid) => ({ type: 'PromoFull', store: sid, lazy: true, name: `PromoFull ${sid}` }))
      : (await ad.list({ maxStores, maxPromoStores: Infinity, types: ['PromoFull'] })).filter((f) => f.type === 'PromoFull');
    r.listSeconds = Math.round((Date.now() - t0) / 1000);
    const t1 = Date.now(); // the time budget is for reading the files, not for listing them (Shufersal's listing alone is slow)
    const budget = Number(process.env[`CHAIN_MINUTES_${key}`] || CHAIN_MINUTES) * 60000;
    const seen = new Set();
    const todo = files.filter((f) => { const s = String(f.store).replace(/^0+(?=\d)/, ''); if (seen.has(s)) return false; seen.add(s); return true; }).slice(0, maxStores);
    r.listed = todo.length;
    console.log(`  ${todo.length} store deal files`);
    await pool(todo, Number(process.env[`PARALLEL_${key}`] || PARALLEL), async (f) => {
      if (Date.now() - t1 > budget) { if (!r.cut) r.errors.push('time budget reached'); r.cut = true; return; }
      const sid = String(f.store).replace(/^0+(?=\d)/, '');
      const chain = storeChain[`${key}:${sid}`] || key;
      try {
        const file = f.lazy ? await ad.listStore('PromoFull', sid) : f;
        if (!file) { r.noFile = (r.noFile || 0) + 1; return; }
        const parsed = parsePromos(decodeFile(await ad.download(file)));
        r.files++;
        const o = diffFor(chain, sid, parsed);
        r.stores++;
        if (Object.keys(o).length) { out[`${chain}:${sid}`] = compact(chain, o); r.withDiff++; }
      } catch (e) { if (r.errors.length < 20) r.errors.push(`${f.name}: ${e.message}`); }
    });
    console.log(`✓ ${ad.name}: ${r.stores}/${r.listed} stores read, ${r.withDiff} with branch-only deals, ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) { r.errors.push(e.message); console.warn(`✗ ${ad.name}: ${e.message}`); }
  r.heapMB = Math.round(process.memoryUsage().heapUsed / 1048576);
  await writeOut(); // after every chain, so a crash late in the run keeps the chains done so far
}

report.finished = new Date().toISOString();
report.basedOn = summary.updated;
await writeOut();
console.log(`Done: ${Object.keys(out).length} stores with branch-only deals → ${OUT}/`);
