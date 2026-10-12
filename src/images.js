// Product photos for the app: one small WebP thumbnail per barcode, packed into chunk files.
//
// The app cannot load images from other websites, so thumbnails are shipped next to it as data:
//   img/NN.json = { "<barcode>": "<base64 webp>" }, NN = chunkOf(barcode), plus img/index.json.
// Sources, in order: Open Food Facts (open database, CC BY-SA), then Rami Levy's product image server.
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
async function fromOff(bc) {
  const r = await get(`https://world.openfoodfacts.org/api/v2/product/${bc}.json?fields=image_front_small_url`);
  if (!r) return null; let url = null; try { url = JSON.parse(r.buf.toString()).product?.image_front_small_url; } catch {}
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

const chunks = Array.from({ length: CHUNKS }, () => ({}));
const stats = { off: 0, rami: 0, miss: 0, bytes: 0 };
const t0 = Date.now();
async function keep(bc, raw, src) {
  if (!raw) { stats.miss++; return; }
  try { const w = await thumb(raw); chunks[chunkOf(bc)][bc] = w.toString('base64'); stats[src]++; stats.bytes += w.length; } catch { stats.miss++; }
}
const log = (n, of) => console.log(`${n}/${of} · off ${stats.off} · rami ${stats.rami} · miss ${stats.miss} · ${Math.round(stats.bytes / 1024)}KB · ${Math.round((Date.now() - t0) / 1000)}s`);
async function pool(list, conc, fn, every = 1000) {
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (next < list.length) { const bc = list[next++]; await fn(bc); if (++done % every === 0) log(done, list.length); } }));
}
const OFF_MINUTES = Number(process.env.OFF_MINUTES || 40);
const offRun = (async () => {   // runs alongside the Rami pass: one request every ~0.7s, stops after OFF_MINUTES
  for (const [i, bc] of offCodes.entries()) {
    if (Date.now() - t0 > OFF_MINUTES * 60000) { console.log(`open food facts: stopped after ${i} products (time limit)`); break; }
    const s = Date.now(); await keep(bc, await fromOff(bc), 'off');
    await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - s))));
  }
})();
await pool(ramiCodes, CONC, async (bc) => keep(bc, await fromRami(bc), 'rami'));
await offRun;
mkdirSync('img', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`img/${String(i).padStart(3, '0')}.json`, JSON.stringify(c)));
const index = { updated: new Date().toISOString(), chunks: CHUNKS, count: stats.off + stats.rami, ...stats };
writeFileSync('img/index.json', JSON.stringify(index));
console.log(JSON.stringify(index));
