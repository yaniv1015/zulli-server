// Probe which public sources return a product photo for Israeli barcodes. Writes data/diag.json.
import { writeFileSync, mkdirSync } from 'node:fs';
const BC = ["7290110115210","7290110115869","7290110115241","7290110115418","7290110115203","7290000136141"];
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'accept-language': 'he-IL,he;q=0.9' };
async function get(url, opt = {}) {
  const t0 = Date.now();
  try { const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000), ...opt });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type'), len: buf.length, ms: Date.now() - t0, buf };
  } catch (e) { return { err: String(e).slice(0, 120), ms: Date.now() - t0 }; }
}
const out = {};
for (const bc of BC) {
  const row = (out[bc] = {});
  const off = await get(`https://world.openfoodfacts.org/api/v2/product/${bc}.json?fields=image_front_small_url,image_front_url,image_url`);
  let offUrl = null; try { const j = JSON.parse(off.buf.toString()); offUrl = j.product?.image_front_small_url || j.product?.image_url || null; } catch {}
  row.off = { status: off.status, url: offUrl };
  if (offUrl) { const im = await get(offUrl); row.offImg = { status: im.status, type: im.type, len: im.len }; }
  for (const [k, u] of Object.entries({
    rami_small: `https://img.rami-levy.co.il/product/${bc}/small.jpg`,
    rami_large: `https://img.rami-levy.co.il/product/${bc}/large.jpg`,
    yoh: `https://yochananof.co.il/media/catalog/product/${bc.slice(0,1)}/${bc.slice(1,2)}/${bc}.jpg`,
  })) { const r = await get(u); row[k] = { status: r.status, type: r.type, len: r.len, err: r.err }; }
  const sh = await get(`https://www.shufersal.co.il/online/he/p/P_${bc}`);
  const html = sh.buf ? sh.buf.toString() : '';
  const m = html.match(/https:\/\/res\.cloudinary\.com\/shufersal\/image\/upload\/[^"' )]+/);
  row.shuf = { status: sh.status, len: sh.len, img: m ? m[0] : null, err: sh.err };
  if (m) { const im = await get(m[0]); row.shufImg = { status: im.status, type: im.type, len: im.len }; }
  const rs = await get(`https://www.rami-levy.co.il/api/catalog`, { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify({ q: bc, store: '331', aggs: 0 }) });
  let rimg = null; try { const j = JSON.parse(rs.buf.toString()); const it = (j.data || [])[0]; rimg = it?.images ? JSON.stringify(it.images).slice(0, 200) : null; } catch {}
  row.ramiApi = { status: rs.status, len: rs.len, images: rimg, err: rs.err };
}
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
