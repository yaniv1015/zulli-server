// Product photos for the app: one small WebP thumbnail per barcode, packed into chunk files.
//
// The app cannot load images from other websites, so thumbnails are shipped next to it as data:
//   img/NN.json = { "<barcode>": "<base64 webp>" }, NN = chunkOf(barcode), plus img/index.json.
// Sources, in order: Open Food Facts (open database, CC BY-SA), then Rami Levy's product image server.
// Retailer photos belong to the retailer; get permission before a public launch.
//
// Usage: node src/images.js [path/to/summary.json] [minChains]
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
const codes = Object.entries(sum.products)
  .filter(([bc, p]) => /^\d{8,14}$/.test(bc) && Object.keys(p.p || {}).length >= MIN_CHAINS)
  .sort((a, b) => Object.keys(b[1].p).length - Object.keys(a[1].p).length)
  .map(([bc]) => bc);
console.log(`${codes.length} products in ${MIN_CHAINS}+ chains`);

// Open Food Facts asks for gentle use: only ask it for the first part, retailer server for the rest.
const OFF_LIMIT = Number(process.env.OFF_LIMIT || 3000);
const chunks = Array.from({ length: CHUNKS }, () => ({}));
const stats = { off: 0, rami: 0, miss: 0, bytes: 0 };
let next = 0, done = 0; const t0 = Date.now();
async function worker() {
  while (next < codes.length) {
    const i = next++, bc = codes[i];
    let raw = null, src = null;
    if (i < OFF_LIMIT) { raw = await fromOff(bc); if (raw) src = 'off'; }
    if (!raw) { raw = await fromRami(bc); if (raw) src = 'rami'; }
    if (raw) { try { const w = await thumb(raw); chunks[chunkOf(bc)][bc] = w.toString('base64'); stats[src]++; stats.bytes += w.length; } catch { stats.miss++; } }
    else stats.miss++;
    if (++done % 500 === 0) console.log(`${done}/${codes.length} · off ${stats.off} · rami ${stats.rami} · miss ${stats.miss} · ${Math.round(stats.bytes / 1024)}KB · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
mkdirSync('img', { recursive: true });
chunks.forEach((c, i) => writeFileSync(`img/${String(i).padStart(3, '0')}.json`, JSON.stringify(c)));
const index = { updated: new Date().toISOString(), chunks: CHUNKS, count: stats.off + stats.rami, ...stats };
writeFileSync('img/index.json', JSON.stringify(index));
console.log(JSON.stringify(index));
