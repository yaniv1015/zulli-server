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

// strong deals right now: "N for X" where one costs at least MIN_PCT less than the regular price
const sum = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const best = new Map();
for (const [bc, p] of Object.entries(sum.products)) {
  if (!/^\d{8,14}$/.test(bc) || !p.d) continue;
  for (const [ch, d] of Object.entries(p.d)) {
    const reg = p.p?.[ch]; if (d[0] !== 'm' || !reg || !d[1]) continue;
    const pct = 1 - d[2] / d[1] / reg;
    if (pct >= MIN_PCT && pct <= 0.86 && pct > (best.get(bc) || 0)) best.set(bc, pct);
  }
}
let haveThumb = new Set();
try { haveThumb = new Set(String(JSON.parse(readFileSync('img/have.json', 'utf8'))).split(',')); } catch {}
// a product with a regular photo, or one Rami sells, is likely to have a sharp one too
const want = [...best.entries()].filter(([bc]) => haveThumb.has(bc) || sum.products[bc].p?.rami != null)
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
const stats = { rami: 0, off: 0, miss: 0, bytes: 0 };
const ramiTodo = todo.filter((bc) => sum.products[bc].p?.rami != null);
const offTodo = todo.filter((bc) => sum.products[bc].p?.rami == null);
async function keep(bc, raw, src) {
  let w = null; try { w = raw && await hd(raw); } catch {}
  if (!w) { stats.miss++; misses[bc] = today; return false; }
  chunks[hdChunk(bc)][bc] = w.toString('base64'); delete misses[bc]; stats[src]++; stats.bytes += w.length; return true;
}
let ramiDone = false;
const ramiRun = (async () => {
  let next = 0, streak = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < ramiTodo.length && !timeUp() && streak < 40) {
      const bc = ramiTodo[next++]; const raw = await fromRami(bc);
      streak = raw ? 0 : streak + 1;
      // Rami-sold product without a Rami shot: try the open databases
      if (raw) await keep(bc, raw, 'rami'); else offTodo.push(bc);
      await sleep(80);
    }
  }));
  ramiDone = true;
})();
const offRun = (async () => {
  let i = 0;
  while (!timeUp()) {
    if (i >= offTodo.length) { if (ramiDone) break; await sleep(1000); continue; }
    const bc = offTodo[i++]; await keep(bc, await fromOpen(bc), 'off');
  }
})();
await Promise.all([ramiRun, offRun]);
mkdirSync('img/hd', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`img/hd/${String(i).padStart(2, '0')}.json`, JSON.stringify(c)));
for (const bc of Object.keys(misses)) if (today - misses[bc] >= 14) delete misses[bc];
writeFileSync('img/hd/misses.json', JSON.stringify(misses));
const all = chunks.flatMap((c) => Object.keys(c)).sort();
writeFileSync('img/hd/have.json', JSON.stringify(all.join(',')));
console.log(JSON.stringify({ hd: all.length, added: stats, minutes: Math.round((Date.now() - t0) / 6e4) }));
