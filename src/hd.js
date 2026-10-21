// Sharp photos for the full-screen deal stories.
//
// The regular thumbnails (img/NN.json, 112 px) are fine in lists but blurry when a story blows them up
// to half the screen. This keeps a second, larger set only for products on a strong deal right now:
//   img/hd/NNN.json = { "<barcode>": "<base64 webp, up to 360 px>" }, NNN = barcode's last 4 digits % HD_CHUNKS
// The photos are cut out here, once: the white around the product is made transparent and cropped away, so the app shows
// them on its dark story without any work on the phone. Small chunks (a few photos each) so a story loads only what it shows.
//   img/hd/have.json = the barcodes in the set, comma-joined (the app checks it before loading a chunk)
// Products that left the deals are dropped, so the set stays small (HD_MAX photos at most).
// Sources: Rami Levy's 600 px shot for what it sells, else the Open Food Facts family's front photo.
// Retailer photos belong to the retailer; get permission before a public launch.
//
// Usage: node src/hd.js [path/to/summary.json]   (run after images.js, from the same folder)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import sharp from 'sharp';

export const HD_CHUNKS = 128;
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
// white background → transparent: flood fill from the edges over near-white pixels, soft edge, crop to the product
async function cutout(input) {
  const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, a = data, seen = new Uint8Array(W * H), q = new Int32Array(W * H); let qh = 0, qt = 0;
  const white = (i) => { const r = a[i * 4], g = a[i * 4 + 1], b = a[i * 4 + 2]; return Math.min(r, g, b) >= 228 && Math.max(r, g, b) - Math.min(r, g, b) < 28; };
  const push = (i) => { if (!seen[i] && white(i)) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (qh < qt) { const i = q[qh++], x = i % W, y = (i / W) | 0; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W); }
  if (qt >= W * H * 0.04) for (let i = 0; i < W * H; i++) {
    if (seen[i]) { a[i * 4 + 3] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && seen[i - 1]) || (x < W - 1 && seen[i + 1]) || (y > 0 && seen[i - W]) || (y < H - 1 && seen[i + W])) { const m = Math.min(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]); a[i * 4 + 3] = m > 200 ? Math.round(255 * (1 - (m - 200) / 55) * 0.85) : 255; }
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03); x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  return sharp(a, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 90 }).toBuffer();
}
async function hd(buf) {
  const m = await sharp(buf).metadata();
  if ((m.width || 0) < 250 && (m.height || 0) < 250) return null;   // not sharper than what we have
  // work at up to twice the final size, so the cut edge stays clean
  return cutout(await sharp(buf).resize(SIZE * 2, SIZE * 2, { fit: 'inside', withoutEnlargement: true }).toBuffer());
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
// earlier runs: any chunk layout (32 two-digit files before, 128 three-digit files now); photos stored before the cut-out
// existed (index without "cut") are cut now, from the stored picture
let prevIx = {}; try { prevIx = JSON.parse(readFileSync(`${PREV}/index.json`, 'utf8')); } catch {}
let recut = 0;
for (const f of (existsSync(PREV) ? readdirSync(PREV) : []).filter((n) => /^\d+\.json$/.test(n))) {
  let c = {}; try { c = JSON.parse(readFileSync(`${PREV}/${f}`, 'utf8')); } catch {}
  for (const [bc, b] of Object.entries(c)) {
    if (!wantSet.has(bc)) continue;
    let v = b;
    if (!prevIx.cut) { try { const w = await cutout(Buffer.from(b, 'base64')); if (w) { v = w.toString('base64'); recut++; } } catch {} }
    chunks[hdChunk(bc)][bc] = v; kept++;
  }
}
console.log(`re-cut ${recut}`);
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
let info = {}; try { info = JSON.parse(readFileSync(`${PREV}/info.json`, 'utf8')); } catch {}
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
// the brand and full name as Carrefour's store shows them: chains' price files often name the importer, not the maker
// (a Samsung TV listed as "ELECTRO FRESCO טלוויזיה חכמה 65 UA"), so stories show the real brand next to the photo
const strOf = (x) => typeof x === 'string' ? x : x && typeof x === 'object' ? (x['1']?.long || x['1']?.short || x['1'] || x.he || x.name || x.long || x.short || Object.values(x).find((y) => typeof y === 'string') || '') : '';
function carInfo(p) {
  if (!p) return null;
  const brand = strOf(p.brand?.names) || strOf(p.brand?.name) || strOf(p.brand) || '';
  const name = strOf(p.names?.['1']?.long ? { 1: p.names['1'].long } : p.names) || '';
  return brand || name ? { brand: String(brand).trim().slice(0, 40), name: String(name).trim().slice(0, 120) } : null;
}
async function carProduct(bc) {
  const f = encodeURIComponent(JSON.stringify({ must: { term: { barcode: bc } } }));
  const r = await get(`https://www.carrefour.co.il/v2/retailers/1540/products?filters=${f}&appId=4`);
  try { return r ? JSON.parse(r.buf.toString()).products?.[0] || null : null; } catch { return null; }
}
async function fromCarrefour(bc) {
  const p = await carProduct(bc); const inf = carInfo(p); if (inf) info[bc] = inf;
  let url = p?.image?.url || p?.images?.[0]?.url;
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
// brand and name for big electrical items on a deal at Carrefour, also when the photo came earlier or from elsewhere
for (const bc of want.filter((b) => (best.get(b) || 0) >= 2 && sells(b, 'carrefour') && !info[b]).slice(0, 300)) {
  const inf = carInfo(await carProduct(bc)); if (inf) info[bc] = inf; await sleep(150);
}
mkdirSync('img/hd', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`img/hd/${String(i).padStart(3, '0')}.json`, JSON.stringify(c)));
for (const bc of Object.keys(misses)) if (today - misses[bc] >= 14) delete misses[bc];
writeFileSync('img/hd/misses.json', JSON.stringify(misses));
for (const bc of Object.keys(info)) if (!wantSet.has(bc)) delete info[bc];
writeFileSync('img/hd/info.json', JSON.stringify(info));
const all = chunks.flatMap((c) => Object.keys(c)).sort();
writeFileSync('img/hd/have.json', JSON.stringify(all.join(',')));
const report = { updated: new Date().toISOString(), chunks: HD_CHUNKS, cut: true, hd: all.length, candidates: want.length, todo: todo.length, added: stats, rami: { todo: ramiTodo.length, ...ramiStat }, carrefour: carStat, off: offTodo.length, minutes: Math.round((Date.now() - t0) / 6e4) };
writeFileSync('img/hd/index.json', JSON.stringify(report));
console.log(JSON.stringify(report));
