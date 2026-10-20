// Diagnostic: where photos of electrical products on a deal can come from → data/diag.json
// Tries each chain's own website (search / product page) and the open barcode databases, and records
// the status and any image addresses that mention the barcode.
import { mkdir, writeFile } from 'node:fs/promises';
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'accept-language': 'he-IL,he;q=0.9' };
const codes = (process.env.CODES || '8806095485775:carrefour,7290109409962:carrefour,7290118471738:carrefour,742779140494:yochananof,6985462458139:yochananof,7290120126404:rami').split(',').map((x) => x.split(':'));
const sources = {
  carrefour: (bc) => [`https://www.carrefour.co.il/search?q=${bc}`, `https://www.carrefour.co.il/product/${bc}`, `https://www.carrefour.co.il/`],
  yochananof: (bc) => [`https://yochananof.co.il/catalogsearch/result/?q=${bc}`, `https://yochananof.co.il/s/${bc}`],
  rami: (bc) => [`https://img.rami-levy.co.il/product/${bc}/medium.jpg`],
  shufersal: (bc) => [`https://www.shufersal.co.il/online/he/p/P_${bc}`, `https://www.shufersal.co.il/online/he/search?text=${bc}`],
  open: (bc) => [`https://world.openproductsfacts.org/api/v2/product/${bc}.json`, `https://api.upcitemdb.com/prod/trial/lookup?upc=${bc}`],
};
const out = {};
async function probe(url, bc) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const type = r.headers.get('content-type') || ''; const buf = Buffer.from(await r.arrayBuffer());
    const res = { status: r.status, final: r.url, type, bytes: buf.length };
    if (!type.startsWith('image/')) {
      const t = buf.toString('utf8');
      res.title = (t.match(/<title[^>]*>([^<]{0,160})/i) || [])[1];
      res.imgs = [...new Set((t.match(/https?:[^"'\s)<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s)<>]*)?/gi) || []))].filter((u) => u.includes(bc) || /product|catalog|media|image/i.test(u)).slice(0, 12);
      res.withCode = res.imgs.filter((u) => u.includes(bc));
      res.apis = [...new Set((t.match(/https?:\/\/[^"'\s<>]*api[^"'\s<>]*/gi) || []))].slice(0, 8);
      if (/json/.test(type)) res.json = t.slice(0, 1500);
      res.head = t.slice(0, 400);
    }
    return res;
  } catch (e) { return { error: e.message }; }
}
for (const [bc, chain] of codes) {
  out[bc] = {};
  for (const src of [chain, 'shufersal', 'open']) for (const u of (sources[src] || (() => []))(bc)) out[bc][u] = await probe(u, bc);
}
await mkdir('data', { recursive: true }); await writeFile('data/diag.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 3000));
