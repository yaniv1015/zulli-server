// Diagnostic: how Carrefour Israel's online store (the "mobilezuz" storefront) serves product photos → data/diag.json
import { mkdir, writeFile } from 'node:fs/promises';
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'accept-language': 'he-IL,he;q=0.9' };
const BC = (process.env.CODES || '8806095485775,7290109409962,7290118471738').split(',');
const out = {};
async function get(url, json) {
  try { const r = await fetch(url, { headers: { ...UA, ...(json ? { accept: 'application/json' } : {}) }, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); return { status: r.status, final: r.url, type: r.headers.get('content-type'), text: t };
  } catch (e) { return { error: e.message, text: '' }; }
}
const home = await get('https://www.carrefour.co.il/');
const t = home.text;
out.homeLen = t.length;
out.scripts = [...t.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 20);
out.snips = [...t.matchAll(/(retailer|branch|apiUrl|frontendUrl|v2\/)[^\n]{0,160}/gi)].map((m) => m[0]).slice(0, 25);
// the storefront's config is often in an inline script or a config endpoint
for (const u of ['https://www.carrefour.co.il/frontend/config', 'https://www.carrefour.co.il/v2/config', 'https://www.carrefour.co.il/config.json']) {
  const r = await get(u, true); out[u] = { status: r.status, type: r.type, head: r.text.slice(0, 800) };
}
// look inside the first app scripts for the API base and retailer id
for (const s of out.scripts.slice(0, 6)) {
  const u = s.startsWith('http') ? s : 'https://www.carrefour.co.il' + (s.startsWith('/') ? '' : '/') + s;
  const r = await get(u);
  out['script ' + u] = { status: r.status, len: r.text.length,
    hits: [...r.text.matchAll(/.{0,80}(retailerId|\/v2\/retailers|product-images|cloudfront|productImage|\/products\?).{0,120}/g)].map((m) => m[0]).slice(0, 15) };
}
await mkdir('data', { recursive: true }); await writeFile('data/diag.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 2000));
