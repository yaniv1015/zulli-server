// Diagnostic: Carrefour Israel's storefront (self-point) product API → product photos by barcode → data/diag.json
import { mkdir, writeFile } from 'node:fs/promises';
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'accept-language': 'he-IL,he;q=0.9', accept: 'application/json, text/plain, */*' };
const BC = (process.env.CODES || '8806095485775,7290109409962,7290118471738').split(',');
const out = {};
async function get(url) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); return { status: r.status, type: r.headers.get('content-type'), text: t };
  } catch (e) { return { error: e.message, text: '' }; }
}
const data = await get('https://htmlcache.blob.core.windows.net/html-production-env/r-1540/mobile/multi-true/data.js');
const bids = [...new Set([...data.text.matchAll(/"branches":\[\{"id":(\d+)/g)].map((m) => m[1]))];
const bid2 = [...new Set([...data.text.matchAll(/"branchId":(\d+)/g)].map((m) => m[1]))].slice(0, 5);
out.branches = { bids, bid2, apiRoots: [...new Set([...data.text.matchAll(/"(?:apiUrl|apiRoot|apiDomain|apiRootDomain)":"([^"]+)"/g)].map((m) => m[1]))] };
const bid = bids[0] || bid2[0] || '1';
const bc = BC[0];
const f = encodeURIComponent(JSON.stringify({ must: { term: { barcode: bc } } }));
const f2 = encodeURIComponent(JSON.stringify({ must: { term: { 'barcode': bc } } }));
const codes = (process.env.CODES || '8806095485775,7290109409962,7290110959418,7290118471738,7290118470410,7290118471301,7290118472971,7290118473602,7290118470113,7290120126404,742779140494,6985462458139').split(',');
const imgOf = (o) => { const found = []; (function walk(x, path) { if (!x || typeof x !== 'object') return; for (const [k, v] of Object.entries(x)) { const p2 = path + '.' + k; if (typeof v === 'string' && /\.(jpe?g|png|webp)|image/i.test(k + v) && /^https?:|\{\{/.test(v)) found.push([p2, v]); else walk(v, p2); } })(o, ''); return found.slice(0, 10); };
for (const c of codes) {
  const ff = encodeURIComponent(JSON.stringify({ must: { term: { barcode: c } } }));
  const r = await get(`https://www.carrefour.co.il/v2/retailers/1540/products?filters=${ff}&appId=4`);
  let j = null; try { j = JSON.parse(r.text); } catch {}
  const p = j?.products?.[0];
  out[c] = { status: r.status, total: j?.total, name: p?.names?.[1]?.short || p?.names?.[1]?.long, images: p ? imgOf(p) : [], keys: p ? Object.keys(p) : [] };
}
await mkdir('data', { recursive: true }); await writeFile('data/diag.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 2000));
