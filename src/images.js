// Product photos for the app: one small WebP thumbnail per barcode, packed into chunk files.
//
// The app cannot load images from other websites, so thumbnails are shipped next to it as data:
//   img/NN.json = { "<barcode>": "<base64 webp>" }, NN = chunkOf(barcode), plus img/index.json.
// Sources: the Open Food Facts family of open databases (food, beauty, pet food, other products; CC BY-SA),
// then Rami Levy's product image server.
// Retailer photos belong to the retailer; get permission before a public launch.
//
// Usage: node src/images.js [path/to/summary.json] [minChains for Open Food Facts]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';

export const CHUNKS = 128;
export const chunkOf = (bc) => Number(String(bc).slice(-4)) % CHUNKS;

const SUMMARY = process.argv[2] || 'data/summary.json';
const MIN_CHAINS = Number(process.argv[3] || 3);
const SIZE = 112, QUALITY = 62, CONC = 12;
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' };

async function get(url, ms = 15000) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null; const type = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer()); return { type, buf };
  } catch { return null; }
}
// the same open API on four sites: a product missing from one is looked up on the next
const OPEN_HOSTS = ['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openpetfoodfacts.org', 'world.openproductsfacts.org'];
async function fromOpen(host, bc) {
  const r = await get(`https://${host}/api/v2/product/${bc}.json?fields=image_front_small_url,image_small_url`);
  if (!r) return null; let url = null; try { const p = JSON.parse(r.buf.toString()).product; url = p?.image_front_small_url || p?.image_small_url; } catch {}
  if (!url) return null; const im = await get(url); return im && im.type.startsWith('image/') ? im.buf : null;
}
async function fromRami(bc) {
  const im = await get(`https://img.rami-levy.co.il/product/${bc}/small.jpg`);
  return im && im.type.startsWith('image/') && im.buf.length > 800 ? im.buf : null;
}
async function thumb(buf) {
  // white square canvas so cut-out product shots look the same as photos
  return sharp(buf).resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' })
    .webp({ quality: QUALITY }).toBuffer();
}

const sum = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const real = Object.entries(sum.products).filter(([bc]) => /^\d{8,14}$/.test(bc));
const nCh = (p) => Object.keys(p.p || {}).length;
// 1) everything Rami Levy sells: its image server has these (fast, parallel)
const ramiCodes = real.filter(([, p]) => p.p?.rami != null).sort((a, b) => nCh(b[1]) - nCh(a[1])).map(([bc]) => bc);
// 2) products Rami does not sell, in MIN_CHAINS+ chains: Open Food Facts, slowly (it allows ~100 product reads a minute)
const offCodes = real.filter(([, p]) => p.p?.rami == null && nCh(p) >= MIN_CHAINS).sort((a, b) => nCh(b[1]) - nCh(a[1])).map(([bc]) => bc);
console.log(`rami: ${ramiCodes.length} · open food facts: ${offCodes.length}`);

// Incremental: start from the photos already on the images branch (checked out into prev/), skip
// barcodes that have one, and skip barcodes that failed recently (prev/img/misses.json, retried after 30 days).
const PREV = 'prev/img';
const chunks = Array.from({ length: CHUNKS }, (_, i) => {
  const f = `${PREV}/${String(i).padStart(3, '0')}.json`; try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; } catch { return {}; }
});
let misses = {}; try { misses = JSON.parse(readFileSync(`${PREV}/misses.json`, 'utf8')); } catch {}
// misses recorded before the beauty, pet and products databases were added are tried again once
let prevIndex = {}; try { prevIndex = JSON.parse(readFileSync(`${PREV}/index.json`, 'utf8')); } catch {}
if (prevIndex.openHosts !== 4) for (const [bc, p] of real) if (p.p?.rami == null) delete misses[bc];
const today = Math.floor(Date.now() / 864e5);
const have = (bc) => chunks[chunkOf(bc)][bc] != null;
const fresh = (bc) => !have(bc) && !(misses[bc] && today - misses[bc] < 30);
const before = chunks.reduce((n, c) => n + Object.keys(c).length, 0);
const stats = { off: 0, rami: 0, miss: 0, bytes: 0 };
const t0 = Date.now();
async function keep(bc, raw, src) {
  if (!raw) { stats.miss++; misses[bc] = today; return false; }
  try { const w = await thumb(raw); chunks[chunkOf(bc)][bc] = w.toString('base64'); delete misses[bc]; stats[src]++; stats.bytes += w.length; return true; }
  catch { stats.miss++; misses[bc] = today; return false; }
}
const log = (n, of) => console.log(`${n}/${of} · off ${stats.off} · rami ${stats.rami} · miss ${stats.miss} · ${Math.round((Date.now() - t0) / 1000)}s`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN_MINUTES = Number(process.env.RUN_MINUTES || 20);
const RAMI_MAX = Number(process.env.RAMI_MAX || 2500);   // the server starts refusing after a few thousand requests from one machine
const timeUp = () => Date.now() - t0 > RUN_MINUTES * 60000;

// Rami Levy: a few requests at a time with pauses. If the server stops answering (a long run of
// failures on products that usually have photos), stop for this run instead of marking them all as missing.
const ramiTodo = ramiCodes.filter(fresh).slice(0, RAMI_MAX);
console.log(`rami to try: ${ramiTodo.length}`);
const ramiInfo = {};
const ramiRun = (async () => {
  let next = 0, streak = 0, stopped = false; const pending = [];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (!stopped && next < ramiTodo.length && !timeUp()) {
      const bc = ramiTodo[next++];
      const raw = await fromRami(bc);
      if (raw) { streak = 0; await keep(bc, raw, 'rami'); } else { streak++; pending.push(bc); }
      if (streak >= 40) { stopped = true; console.log(`rami: 40 failures in a row at ${next}, stopping this run`); }
      if (next % 1000 === 0) log(next, ramiTodo.length);
      await sleep(60);
    }
  }));
  // failures count as real misses only if the server was still answering afterwards
  const confirmed = stopped ? pending.slice(0, Math.max(0, pending.length - 40)) : pending;
  ramiInfo.tried = next; ramiInfo.stopped = stopped;
  for (const bc of confirmed) { misses[bc] = today; stats.miss++; }
})();
// Open databases: each site gets one request every ~0.7s (their published limit is about 100 a minute);
// a barcode one site does not have goes on to the next site's queue, and is a miss only after all four
const offTodo = offCodes.filter(fresh);
const queues = OPEN_HOSTS.map(() => []); queues[0].push(...offTodo); const done = new Set();
const offRun = Promise.all(OPEN_HOSTS.map(async (host, h) => {
  for (;;) {
    if (timeUp()) break;
    const bc = queues[h].shift();
    if (bc === undefined) { if (h === 0 || [...Array(h).keys()].every((i) => done.has(i))) break; await sleep(500); continue; }
    const s = Date.now(); const raw = await fromOpen(host, bc);
    if (raw) await keep(bc, raw, 'off');
    else if (h + 1 < OPEN_HOSTS.length) queues[h + 1].push(bc);
    else await keep(bc, null, 'off');
    await sleep(Math.max(0, 700 - (Date.now() - s)));
  }
  done.add(h);
}));
await Promise.all([ramiRun, offRun]);
const after = chunks.reduce((n, c) => n + Object.keys(c).length, 0);
console.log(`photos: ${before} → ${after}`);
mkdirSync('img', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`img/${String(i).padStart(3, '0')}.json`, JSON.stringify(c)));
writeFileSync('img/misses.json', JSON.stringify(misses));
const index = { updated: new Date().toISOString(), openHosts: 4, chunks: CHUNKS, count: after, added: { off: stats.off, rami: stats.rami }, misses: Object.keys(misses).length, rami: { todo: ramiCodes.filter(fresh).length, ...ramiInfo } };
writeFileSync('img/index.json', JSON.stringify(index));
console.log(JSON.stringify(index));
