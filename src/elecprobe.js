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
const tries = [
  `https://www.carrefour.co.il/v2/retailers/1540/branches/${bid}/products?filters=${f}&appId=4`,
  `https://www.carrefour.co.il/v2/retailers/1540/branches/${bid}/products?query=${bc}&appId=4`,
  `https://www.carrefour.co.il/v2/retailers/1540/branches/${bid}/products/search?query=${bc}&appId=4`,
  `https://www.carrefour.co.il/v2/retailers/1540/branches/${bid}/products?size=1&filters=${f2}`,
  `https://www.carrefour.co.il/v2/retailers/1540/products?filters=${f}&appId=4`,
  `https://www.carrefour.co.il/v2/retailers/1540/branches/${bid}/products/barcode/${bc}`,
];
for (const u of tries) { const r = await get(u); out[u] = { status: r.status, type: r.type, head: r.text.slice(0, 1200), imgs: [...new Set(r.text.match(/https?:[^"]+?\.(?:jpe?g|png|webp)/g) || [])].slice(0, 6) }; }
await mkdir('data', { recursive: true }); await writeFile('data/diag.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 2000));
