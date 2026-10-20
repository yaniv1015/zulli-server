// Sharp photos for the full-screen deal stories.
//
// The regular thumbnails (img/NN.json, 112 px) are fine in lists but blurry when a story blows them up
// to half the screen. This keeps a second, larger set only for products on a strong deal right now:
//   img/hd/NN.json = { "<barcode>": "<base64 webp, 360 px>" }, NN = barcode's last 4 digits % HD_CHUNKS
//   img/hd/have.json = the barcodes in the set, comma-joined (the app checks it before loading a chunk)
// Products that left the deals are dropped, so the set stays small (HD_MAX photos at most).
// Sources: Rami Levy's 600 px shot for what it sells, else the Open Food Facts family's front photo.
// Retailer photos belong to the retailer; get permission before a public launch.
//
// Usage: node src/hd.js [path/to/summary.json]   (run after images.js, from the same folder)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';

export const HD_CHUNKS = 32;
const hdChunk = (bc) => Number(String(bc).slice(-4)) % HD_CHUNKS;
const SUMMARY = process.argv[2] || 'data/summary.json';
const SIZE = 360, QUALITY = 74;
const HD_MAX = Number(process.env.HD_MAX || 1500);
const MIN_PCT = 0.3;
const RUN_MINUTES = Number(process.env.HD_MINUTES || 12);
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' };
const t0 = Date.now();
const timeUp = () => Date.now() - t0 > RUN_MINUTES * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, ms = 15000) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null; const type = r.headers.get('content-type') || '';
    return { type, buf: Buffer.from(await r.arrayBuffer()) };
  } catch { return null; }
}
async function fromRami(bc) {
  const im = await get(`https://img.rami-levy.co.il/product/${bc}/medium.jpg`);
  return im && im.type.startsWith('image/') && im.buf.length > 3000 ? im.buf : null;
}
const OPEN_HOSTS = ['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openproductsfacts.org'];
async function fromOpen(bc) {
  for (const host of OPEN_HOSTS) {
    const r = await get(`https://${host}/api/v2/product/${bc}.json?fields=image_front_url,image_url`);
    await sleep(700);
    if (!r) continue; let url = null;
    try { const p = JSON.parse(r.buf.toString()).product; url = p?.image_front_url || p?.image_url; } catch {}
    if (!url) continue;
    const im = await get(url); if (im && im.type.startsWith('image/')) return im.buf;
  }
  return null;
}
async function hd(buf) {
  const img = sharp(buf); const m = await img.metadata();
  if ((m.width || 0) < 250 && (m.height || 0) < 250) return null;   // not sharper than what we have
  return img.trim({ threshold: 12 }).resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff', withoutEnlargement: false })
    .flatten({ background: '#ffffff' }).webp({ quality: QUALITY }).toBuffer();
}

const BIG_RX = /טלוויזי|טלויזי|מסך\s*\d{2}|מקרר|מכונת כביסה|מייבש|מדיח|תנור|מיקרוגל|שואב|מזגן|מאוורר|מעבד מזון|מכונת קפה|טוסטר|קומקום|בלנדר|מיקסר|מיחם|אוזניות|רמקול|מגהץ|מחליק|מייבש שיער|סיר לחץ|airfryer|נינג'ה|ninja|טאבלט|סמארטפון|גלקסי|אייפון|שעון חכם|קורקינט/i;
const BIG = (p) => Math.max(0, ...Object.values(p.p || {})) >= 150 && BIG_RX.test(p.n || '') && !/שידת|כורסא|קרם|קפסולות|טבליות|תרכיז|נוזל|מפיץ ריח/.test(p.n || '');
// strong deals right now: "N for X" where one costs at least MIN_PCT less than the regular price
const sum = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const best = new Map();
for (const [bc, p] of Object.entries(sum.products)) {
  if (!/^\d{8,14}$/.test(bc) || !p.d) continue;
  for (const [ch, d] of Object.entries(p.d)) {
    const reg = p.p?.[ch]; if (d[0] !== 'm' || !reg || !d[1]) continue;
    const pct = 1 - d[2] / d[1] / reg;
    // big electrical items get in from 10% off and go first: a photo matters most where models differ
    const score = BIG(p) ? (pct >= 0.1 ? 2 + pct : 0) : (pct >= MIN_PCT ? pct : 0);
    if (score && pct <= 0.86 && score > (best.get(bc) || 0)) best.set(bc, score);
  }
}
let haveThumb = new Set();
for (const f of ['img/have.json', 'prev/img/have.json']) { try { haveThumb = new Set(String(JSON.parse(readFileSync(f, 'utf8'))).split(',')); break; } catch {} }
// a product with a regular photo, or one Rami sells, is likely to have a sharp one too
const want = [...best.entries()].filter(([bc]) => haveThumb.has(bc) || sum.products[bc].p?.rami != null || sum.products[bc].p?.carrefour != null)
  .sort((a, b) => b[1] - a[1]).slice(0, HD_MAX).map(([bc]) => bc);
const wantSet = new Set(want);
console.log(`deals ≥${MIN_PCT * 100}%: ${best.size} · hd candidates: ${want.length}`);

const PREV = 'prev/img/hd';
const chunks = Array.from({ length: HD_CHUNKS }, () => ({}));
let misses = {}; try { misses = JSON.parse(readFileSync(`${PREV}/misses.json`, 'utf8')); } catch {}
let kept = 0;
for (let i = 0; i < HD_CHUNKS; i++) {
  const f = `${PREV}/${String(i).padStart(2, '0')}.json`;
  let c = {}; try { if (existsSync(f)) c = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  for (const [bc, b] of Object.entries(c)) if (wantSet.has(bc)) { chunks[i][bc] = b; kept++; }
}
const today = Math.floor(Date.now() / 864e5);
const todo = want.filter((bc) => chunks[hdChunk(bc)][bc] == null && !(misses[bc] && today - misses[bc] < 14));
console.log(`kept ${kept} · to fetch ${todo.length}`);
const stats = { rami: 0, carrefour: 0, off: 0, miss: 0, bytes: 0 };
const sells = (bc, ch) => sum.products[bc].p?.[ch] != null;
const ramiTodo = todo.filter((bc) => sells(bc, 'rami'));
const carTodo = todo.filter((bc) => !sells(bc, 'rami') && sells(bc, 'carrefour'));
const offTodo = todo.filter((bc) => !sells(bc, 'rami') && !sells(bc, 'carrefour'));
let carDone = false; const carStat = { tried: 0, found: 0 };
async function keep(bc, raw, src) {
  let w = null; try { w = raw && await hd(raw); } catch {}
  if (!w) { stats.miss++; misses[bc] = today; return false; }
  chunks[hdChunk(bc)][bc] = w.toString('base64'); delete misses[bc]; stats[src]++; stats.bytes += w.length; return true;
}
let ramiDone = false; const ramiStat = { tried: 0, stopped: false };
const ramiRun = (async () => {
  let next = 0, streak = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < ramiTodo.length && !timeUp() && streak < 40) {
      const bc = ramiTodo[next++]; const raw = await fromRami(bc);
      streak = raw ? 0 : streak + 1; ramiStat.tried++; if (streak >= 40) ramiStat.stopped = true;
      // Rami-sold product without a Rami shot: try the open databases
      if (raw) await keep(bc, raw, 'rami'); else (sells(bc, 'carrefour') ? carTodo : offTodo).push(bc);
      await sleep(80);
    }
  }));
  ramiDone = true;
})();
// Carrefour's online store (self-point storefront): its product API gives the photo for a barcode
async function fromCarrefour(bc) {
  const f = encodeURIComponent(JSON.stringify({ must: { term: { barcode: bc } } }));
  const r = await get(`https://www.carrefour.co.il/v2/retailers/1540/products?filters=${f}&appId=4`);
  if (!r) return null; let url = null;
  try { const p = JSON.parse(r.buf.toString()).products?.[0]; url = p?.image?.url || p?.images?.[0]?.url; } catch {}
  if (!url) return null;
  url = url.replace('{{size}}', 'large').replace(/\{\{extension[^}]*\}\}/, 'jpg');
  const im = await get(url); return im && im.type.startsWith('image/') && im.buf.length > 3000 ? im.buf : null;
}
const carRun = (async () => {
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (!timeUp()) {
      if (i >= carTodo.length) { if (ramiDone) break; await sleep(1000); continue; }
      const bc = carTodo[i++]; carStat.tried++; const raw = await fromCarrefour(bc);
      if (raw) { carStat.found++; await keep(bc, raw, 'carrefour'); } else offTodo.push(bc);
      await sleep(150);
    }
  }));
  carDone = true;
})();
const offRun = (async () => {
  let i = 0;
  while (!timeUp()) {
    if (i >= offTodo.length) { if (ramiDone && carDone) break; await sleep(1000); continue; }
    const bc = offTodo[i++]; await keep(bc, await fromOpen(bc), 'off');
  }
})();
await Promise.all([ramiRun, carRun, offRun]);
mkdirSync('img/hd', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`img/hd/${String(i).padStart(2, '0')}.json`, JSON.stringify(c)));
for (const bc of Object.keys(misses)) if (today - misses[bc] >= 14) delete misses[bc];
writeFileSync('img/hd/misses.json', JSON.stringify(misses));
const all = chunks.flatMap((c) => Object.keys(c)).sort();
writeFileSync('img/hd/have.json', JSON.stringify(all.join(',')));
const report = { updated: new Date().toISOString(), hd: all.length, candidates: want.length, todo: todo.length, added: stats, rami: { todo: ramiTodo.length, ...ramiStat }, carrefour: carStat, off: offTodo.length, minutes: Math.round((Date.now() - t0) / 6e4) };
writeFileSync('img/hd/index.json', JSON.stringify(report));
console.log(JSON.stringify(report));
